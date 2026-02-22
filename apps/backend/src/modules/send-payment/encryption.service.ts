import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * SEND_PAYMENT_ENC_KEY: Used to encrypt/decrypt the one-time burner wallet private key for send-payment links.
 * When a link is created we generate a burner keypair; the secret is encrypted with this key and stored in the DB.
 * On claim/reclaim the backend decrypts it to sign the transfer. Set to a 32-byte hex string or 32+ char UTF-8 string.
 * Without it, send-payment create/claim/reclaim will not work.
 */
const ALGO = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;

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
  private readonly logger = new Logger(SendPaymentEncryptionService.name);

  constructor(private readonly config: ConfigService) {
    let raw =
      this.config.get<string>('SEND_PAYMENT_ENC_KEY') ??
      (typeof process !== 'undefined' ? process.env.SEND_PAYMENT_ENC_KEY : undefined);
    if (!raw || typeof raw !== 'string') {
      raw = getEnvFromFile('SEND_PAYMENT_ENC_KEY') ?? undefined;
    }
    if (!raw || typeof raw !== 'string') {
      this.logger.warn('SEND_PAYMENT_ENC_KEY not set or empty; send-payment/claim encrypt/decrypt disabled');
      return;
    }
    const trimmed = raw.trim();
    const hexBuf = Buffer.from(trimmed, 'hex');
    if (hexBuf.length === KEY_LENGTH) {
      this.key = hexBuf;
      this.logger.log('SEND_PAYMENT_ENC_KEY loaded (32-byte hex); encryption available');
    } else if (trimmed.length >= 32) {
      this.key = Buffer.from(trimmed.slice(0, 32), 'utf8');
      this.logger.log('SEND_PAYMENT_ENC_KEY loaded (32+ char); encryption available');
    } else {
      this.logger.warn(`SEND_PAYMENT_ENC_KEY length ${trimmed.length} (need 32-byte hex or 32+ chars); encryption disabled`);
    }
  }

  isAvailable(): boolean {
    return this.key !== null && this.key.length === KEY_LENGTH;
  }

  encrypt(plaintext: Buffer): string {
    if (!this.key) {
      throw new Error('SEND_PAYMENT_ENC_KEY not configured');
    }
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, this.key, iv, { authTagLength: TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(ciphertextBase64: string): Buffer {
    if (!this.key) {
      throw new Error('SEND_PAYMENT_ENC_KEY not configured');
    }
    const buf = Buffer.from(ciphertextBase64, 'base64');
    if (buf.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Invalid ciphertext');
    }
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGO, this.key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}
