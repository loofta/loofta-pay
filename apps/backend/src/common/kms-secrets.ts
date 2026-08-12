import { Logger } from '@nestjs/common';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const logger = new Logger('KmsSecrets');

/**
 * KMS-encrypted secrets bootstrap for Railway deployment.
 *
 * Required env vars in Railway:
 *   GCP_PROJECT_ID                    = your GCP project id (e.g. "loofta")
 *   GCP_SA_KEY_BASE64                 = base64-encoded service account JSON key
 *   KMS_SOLANA_FEE_PAYER_PRIVATE_KEY  = base64-encoded ciphertext
 *   KMS_SEND_PAYMENT_ENC_KEY          = base64-encoded ciphertext
 *
 * Optional:
 *   KMS_KEY_RING   = keyring name (default: "looftapay")
 *   KMS_LOCATION   = location (default: "global")
 *
 * Call this BEFORE NestFactory.create() in main.ts.
 */

const KMS_SECRETS = [
  'SOLANA_FEE_PAYER_PRIVATE_KEY',
  'SEND_PAYMENT_ENC_KEY',
  'SEND_PAYMENT_ENC_KEY_OLD',
  // Twitter bot auto-pay authorization key (see docs/GCP_KMS_SECRETS.md). Deliberately NOT in
  // REQUIRED_IN_PRODUCTION yet — the auto-pay signing code that actually consumes this hasn't
  // shipped, so failing boot over a still-unused secret would be wrong. Add it there once that
  // code path exists and depends on it.
  'LOOFTA_BOT_AUTH_PRIVATE_KEY',
] as const;

// _OLD is only ever present during a key-rotation window, so it's excluded here —
// these two are the ones production must never silently run without.
const REQUIRED_IN_PRODUCTION = ['SOLANA_FEE_PAYER_PRIVATE_KEY', 'SEND_PAYMENT_ENC_KEY'] as const;

export async function loadKmsSecrets(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';
  const hasAnyKmsSecret = KMS_SECRETS.some(
    (name) => !!process.env[`KMS_${name}`],
  );

  if (!hasAnyKmsSecret) {
    if (isProduction) {
      // Fail closed: a production boot with no KMS_* vars at all would otherwise silently run
      // on whatever plaintext SEND_PAYMENT_ENC_KEY/SOLANA_FEE_PAYER_PRIVATE_KEY happen to be set,
      // with no signal that KMS wrapping was ever expected. Local/dev keeps the plaintext-env
      // fallback below — this check is production-only.
      throw new Error(
        'No KMS_* env vars found in production (expected at least KMS_SOLANA_FEE_PAYER_PRIVATE_KEY ' +
          'and KMS_SEND_PAYMENT_ENC_KEY). Refusing to boot on plaintext secrets in production — see kms-secrets.ts.',
      );
    }
    logger.log(
      'No KMS_* env vars found — skipping KMS decryption (using plain env vars)',
    );
    return;
  }

  // On Railway: write the service account JSON from base64 env var to a temp file
  // so the GCP SDK can authenticate
  let tmpKeyPath: string | null = null;
  const saKeyBase64 = process.env.GCP_SA_KEY_BASE64;
  if (saKeyBase64) {
    tmpKeyPath = join(tmpdir(), `gcp-sa-${process.pid}.json`);
    writeFileSync(tmpKeyPath, Buffer.from(saKeyBase64, 'base64'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpKeyPath;
    logger.log('GCP service account credentials loaded from GCP_SA_KEY_BASE64');
  }

  const client = new KeyManagementServiceClient();

  // Build key name from convenience vars or per-secret override
  const project = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.KMS_LOCATION || 'global';
  const keyRing = process.env.KMS_KEY_RING || 'looftapay';

  const decrypted = new Set<string>();

  for (const secretName of KMS_SECRETS) {
    const ciphertextBase64 = process.env[`KMS_${secretName}`];
    if (!ciphertextBase64) continue;

    // Full resource name — either explicit or built from parts
    const keyName =
      process.env[`KMS_${secretName}_KEY_NAME`] ||
      (project
        ? client.cryptoKeyPath(project, location, keyRing, secretName)
        : null);

    if (!keyName) {
      logger.error(
        `KMS_${secretName} is set but cannot build key path — set GCP_PROJECT_ID or KMS_${secretName}_KEY_NAME`,
      );
      continue;
    }

    try {
      const ciphertext = Buffer.from(ciphertextBase64, 'base64');
      const [result] = await client.decrypt({
        name: keyName,
        ciphertext,
      });

      const plaintext =
        result.plaintext instanceof Uint8Array
          ? Buffer.from(result.plaintext).toString('utf8')
          : (result.plaintext as string);

      process.env[secretName] = plaintext;
      decrypted.add(secretName);
      logger.log(
        `Decrypted ${secretName} via KMS (key: ...${keyName.slice(-40)})`,
      );
    } catch (err) {
      logger.error(
        `Failed to decrypt ${secretName} from KMS: ${(err as Error).message}`,
      );
    }
  }

  client.close();

  // Clean up temp credentials file
  if (tmpKeyPath) {
    try {
      unlinkSync(tmpKeyPath);
    } catch {
      // ignore
    }
  }

  if (isProduction) {
    // Fail closed: a required secret that's missing its KMS_* var, has a bad key path, or failed
    // to decrypt would otherwise leave process.env[secretName] on whatever plaintext value (or
    // undefined) it already had — silently running production on an unwrapped or stale key.
    const missing = REQUIRED_IN_PRODUCTION.filter((name) => !decrypted.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Production KMS decryption incomplete for required secret(s): ${missing.join(', ')}. ` +
          'Refusing to boot rather than fall back to a plaintext/stale value — see kms-secrets.ts.',
      );
    }
  }
}
