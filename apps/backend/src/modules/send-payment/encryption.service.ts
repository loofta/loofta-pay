import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * SEND_PAYMENT_ENC_KEY: Used to encrypt/decrypt the one-time burner wallet private key for send-payment links.
 * When a link is created we generate a burner keypair; the secret is encrypted with this key and stored in the DB.
 * On claim/reclaim the backend decrypts it to sign the transfer. Set to a 32-byte hex string or 32+ char UTF-8 string.
 *
 * Key rotation:
 *   Set SEND_PAYMENT_ENC_KEY to the NEW key and SEND_PAYMENT_ENC_KEY_OLD to the previous key.
 *   The service will encrypt with the new key and fall back to the old key when decrypting legacy ciphertexts.
 *   After running the /claims/admin/rotate-burner-keys migration, SEND_PAYMENT_ENC_KEY_OLD can be removed.
 *
 * Per-payment key derivation (v2 format):
 *   encrypt(plaintext, context) produces "v2:<base64>" where the AES key is
 *   HKDF(master_key, context). The context is the burner wallet's public key,
 *   so each payment uses a unique derived key. Compromising one payment's key
 *   does not compromise any other payment.
 */
const ALGO = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;

/** V2 ciphertext prefix — marks per-context HKDF-derived key encryption */
export const V2_PREFIX = 'v2:';

/** Read env var from .env.local when ConfigService/process.env don't have it. */
function getEnvFromFile(varName: string): string | null {
  const tryPaths = [
    join(process.cwd(), 'apps', 'backend', '.env.local'),
    join(process.cwd(), '.env.local'),
    join(__dirname, '..', '..', '..', '.env.local'),
    join(__dirname, '..', '..', '.env.local'),
  ];
  for (const p of tryPaths) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf8');
        const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = content.match(new RegExp(`${escaped}\\s*=\\s*(["']?)([^\\s#'"]+)\\1`));
        if (match?.[2]) return match[2].trim();
      }
    } catch {
      // ignore
    }
  }
  return null;
}

@Injectable()
export class SendPaymentEncryptionService {
  private readonly key: Buffer | null = null;
  /** Previous master key — used only for decrypting legacy ciphertexts during key rotation */
  private readonly oldKey: Buffer | null = null;
  private readonly logger = new Logger(SendPaymentEncryptionService.name);

  constructor(private readonly config: ConfigService) {
    this.key = this.loadKey('SEND_PAYMENT_ENC_KEY');
    this.oldKey = this.loadKey('SEND_PAYMENT_ENC_KEY_OLD');

    if (!this.key) {
      this.logger.warn('SEND_PAYMENT_ENC_KEY not set or empty; send-payment/claim encrypt/decrypt disabled');
    } else {
      this.logger.log(`SEND_PAYMENT_ENC_KEY loaded; oldKey=${this.oldKey ? 'present (rotation mode)' : 'absent'}`);
    }
  }

  isAvailable(): boolean {
    return this.key !== null && this.key.length === KEY_LENGTH;
  }

  /**
   * Encrypt plaintext.
   *
   * @param plaintext  Raw bytes to encrypt (e.g. a Solana secret key).
   * @param context    Optional unique string (e.g. burner public key). When provided,
   *                   a per-context AES key is derived via HKDF so each payment uses
   *                   a distinct key. Output is prefixed with "v2:".
   *                   Omit for legacy v1 format (master key used directly).
   */
  encrypt(plaintext: Buffer, context?: string): string {
    if (!this.key) throw new Error('SEND_PAYMENT_ENC_KEY not configured');
    const aesKey = context ? this.deriveKey(this.key, context) : this.key;
    const ciphertext = this.encryptWithKey(plaintext, aesKey);
    return context ? `${V2_PREFIX}${ciphertext}` : ciphertext;
  }

  /**
   * Decrypt ciphertext produced by encrypt().
   *
   * Handles both formats transparently:
   *   • v2:<base64>  — per-context HKDF key (context = burner public key)
   *   • <base64>     — legacy master-key encryption
   *
   * Falls back to SEND_PAYMENT_ENC_KEY_OLD for legacy ciphertexts during key rotation.
   *
   * @param ciphertextBase64  String from the database.
   * @param context           Required when ciphertext was produced with a context (v2 format).
   */
  decrypt(ciphertextBase64: string, context?: string): Buffer {
    if (!this.key) throw new Error('SEND_PAYMENT_ENC_KEY not configured');

    if (ciphertextBase64.startsWith(V2_PREFIX)) {
      // v2: per-context derived key — context (burner address) is mandatory
      const raw = ciphertextBase64.slice(V2_PREFIX.length);
      const aesKey = this.deriveKey(this.key, context ?? '');
      return this.decryptWithKey(raw, aesKey);
    }

    // Legacy v1: try primary key first, then old key (rotation window)
    try {
      return this.decryptWithKey(ciphertextBase64, this.key);
    } catch (primaryErr) {
      if (this.oldKey) {
        this.logger.warn('Primary key failed; retrying with SEND_PAYMENT_ENC_KEY_OLD (rotation fallback)');
        return this.decryptWithKey(ciphertextBase64, this.oldKey);
      }
      throw primaryErr;
    }
  }

  /** True when the old key is present — signals active rotation window */
  get isRotating(): boolean {
    return this.oldKey !== null;
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * HKDF using HMAC-SHA256 (RFC 5869 single-block extract+expand).
   * Produces a 32-byte key unique to (masterKey, context).
   */
  private deriveKey(masterKey: Buffer, context: string): Buffer {
    // Extract: PRK = HMAC-SHA256(salt="loofta-burner-key-v1", IKM=masterKey)
    const prk = createHmac('sha256', 'loofta-burner-key-v1').update(masterKey).digest();
    // Expand: OKM = HMAC-SHA256(PRK, context || 0x01)
    return createHmac('sha256', prk).update(`${context}\x01`).digest();
  }

  private encryptWithKey(plaintext: Buffer, key: Buffer): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decryptWithKey(ciphertextBase64: string, key: Buffer): Buffer {
    const buf = Buffer.from(ciphertextBase64, 'base64');
    if (buf.length < IV_LENGTH + TAG_LENGTH) throw new Error('Invalid ciphertext length');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  private loadKey(envVar: string): Buffer | null {
    let raw =
      this.config.get<string>(envVar) ??
      (typeof process !== 'undefined' ? process.env[envVar] : undefined);
    if (!raw || typeof raw !== 'string') {
      raw = getEnvFromFile(envVar) ?? undefined;
    }
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    const hexBuf = Buffer.from(trimmed, 'hex');
    if (hexBuf.length === KEY_LENGTH) return hexBuf;
    if (trimmed.length >= KEY_LENGTH) return Buffer.from(trimmed.slice(0, KEY_LENGTH), 'utf8');
    this.logger.warn(`${envVar} is too short (need 32-byte hex or 32+ chars); ignoring`);
    return null;
  }
}
