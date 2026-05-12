// Compact alphanumeric IDs for share URLs — stored as payments.short_id.
// 8-char base62 ≈ 218 trillion combinations; negligible collision risk at scale.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_VALID = Math.floor(256 / ALPHABET.length) * ALPHABET.length; // rejection sampling threshold

export function generateShortId(length = 8): string {
  let result = '';
  while (result.length < length) {
    const bytes = new Uint8Array(length - result.length + 4);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < MAX_VALID && result.length < length) {
        result += ALPHABET[byte % ALPHABET.length];
      }
    }
  }
  return result;
}

export const SHORT_ID_RE = /^[0-9a-zA-Z]{8}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
