/**
 * Vault crypto for private claim: passphrase and session-signature encryption.
 * Uses Node.js built-in crypto only (no tweetnacl).
 */
import {
  createHash,
  randomBytes,
  randomInt,
  pbkdf2Sync,
  createCipheriv,
  createDecipheriv,
} from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface PassphraseEncryptedPayload {
  ciphertext: string;
  nonce: string;
  salt: string;
}

const ADJECTIVES = [
  'amber', 'ancient', 'arctic', 'autumn', 'azure', 'bitter', 'blazing', 'bold',
  'brave', 'bright', 'bronze', 'calm', 'carbon', 'cedar', 'chrome', 'citrus',
];
const NOUNS = [
  'arrow', 'atlas', 'aurora', 'badge', 'basin', 'beacon', 'bear', 'blade',
  'blaze', 'bloom', 'bolt', 'bond', 'bridge', 'brook', 'canyon', 'cape',
];

export function generatePassphrase(): string {
  const a1 = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const n1 = NOUNS[randomInt(NOUNS.length)];
  const a2 = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const n2 = NOUNS[randomInt(NOUNS.length)];
  const num = randomInt(1000).toString().padStart(3, '0');
  return `${a1}-${n1}-${a2}-${n2}-${num}`;
}

function deriveKey(passphrase: string, salt: Uint8Array): Buffer {
  const key = pbkdf2Sync(passphrase, salt, 100_000, KEY_LENGTH, 'sha256');
  return Buffer.from(key);
}

function encryptAesGcm(plaintext: Uint8Array, key: Buffer): { iv: Buffer; tag: Buffer; ciphertext: Buffer } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ciphertext: encrypted };
}

function decryptAesGcm(iv: Buffer, tag: Buffer, ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptWithPassphrase(data: Uint8Array, passphrase: string): PassphraseEncryptedPayload {
  const salt = randomBytes(16);
  const key = deriveKey(passphrase, salt);
  const { iv, tag, ciphertext } = encryptAesGcm(data, key);
  const combined = Buffer.concat([iv, tag, ciphertext]);
  return {
    ciphertext: combined.toString('base64'),
    nonce: salt.toString('base64'),
    salt: salt.toString('base64'),
  };
}

export function decryptWithPassphrase(payload: PassphraseEncryptedPayload, passphrase: string): Uint8Array {
  const salt = Buffer.from(payload.salt, 'base64');
  const key = deriveKey(passphrase, salt);
  const combined = Buffer.from(payload.ciphertext, 'base64');
  if (combined.length < IV_LENGTH + TAG_LENGTH) throw new Error('Decryption failed - invalid passphrase');
  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);
  return new Uint8Array(decryptAesGcm(iv, tag, ciphertext, key));
}

function deriveKeyFromSignature(sessionSignature: Uint8Array): Buffer {
  const hash = createHash('sha256');
  hash.update(sessionSignature);
  return Buffer.from(hash.digest());
}

export function encryptWithSessionSignature(
  data: Uint8Array,
  sessionSignature: Uint8Array,
): PassphraseEncryptedPayload {
  const key = deriveKeyFromSignature(sessionSignature);
  const { iv, tag, ciphertext } = encryptAesGcm(data, key);
  const combined = Buffer.concat([iv, tag, ciphertext]);
  return {
    ciphertext: combined.toString('base64'),
    nonce: iv.toString('base64'),
    salt: '',
  };
}

export function decryptWithSessionSignature(
  payload: PassphraseEncryptedPayload,
  sessionSignature: Uint8Array,
): Uint8Array {
  const key = deriveKeyFromSignature(sessionSignature);
  const combined = Buffer.from(payload.ciphertext, 'base64');
  if (combined.length < IV_LENGTH + TAG_LENGTH) throw new Error('Decryption failed - invalid session signature');
  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);
  return new Uint8Array(decryptAesGcm(iv, tag, ciphertext, key));
}
