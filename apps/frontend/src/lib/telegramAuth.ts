import { createHash, createHmac, timingSafeEqual } from "crypto";

export interface TelegramAuthPayload {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
}

/** Telegram widget data is only meant to represent a login that just happened. */
const MAX_AUTH_AGE_SECONDS = 5 * 60;

/**
 * Verifies a Telegram Login Widget payload per Telegram's own documented algorithm
 * (https://core.telegram.org/widgets/login#checking-authorization): recompute the HMAC-SHA256
 * over the sorted, non-hash fields using SHA256(bot token) as the key, and compare against the
 * `hash` field the widget sent — in constant time, so a partial-match timing side-channel can't
 * leak the correct hash byte-by-byte. This is the ONLY thing that proves a `username` genuinely
 * belongs to whoever completed the widget flow; nothing calling this may trust a client-supplied
 * handle without it, or the "connect Telegram" flow reduces to "assert any handle you want."
 */
export function verifyTelegramAuth(payload: TelegramAuthPayload): { valid: boolean; reason?: string } {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return { valid: false, reason: "Server misconfigured (no bot token)." };
  }
  const { hash, ...rest } = payload;
  if (!hash || typeof hash !== "string") {
    return { valid: false, reason: "Missing hash." };
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) {
    return { valid: false, reason: "Missing or invalid auth_date." };
  }
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -30) {
    return { valid: false, reason: "Login has expired — please try again." };
  }

  const dataCheckString = Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "Signature mismatch." };
  }

  return { valid: true };
}
