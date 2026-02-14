import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * SEND_PAYMENT_ENC_KEY: Used to encrypt/decrypt the one-time burner wallet private key for send-payment links.
 * When a link is created we generate a burner keypair; the secret is encrypted with this key and stored in the DB.
 * On claim/reclaim the backend decrypts it to sign the transfer. Set to a 32-byte hex string or 32+ char UTF-8 string.
 * Without it, send-payment create/claim/reclaim will not work.
 */
const ALGO = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;

@Injectable()
export class SendPaymentEncryptionService {
  private readonly key: Buffer | null = null;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('SEND_PAYMENT_ENC_KEY');
    if (!raw) return;
    const hexBuf = Buffer.from(raw, 'hex');
    if (hexBuf.length === KEY_LENGTH) {
      this.key = hexBuf;
    } else if (raw.length >= 32) {
      this.key = Buffer.from(raw.slice(0, 32), 'utf8');
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
