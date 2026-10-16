/**
 * Parses a payment command typed to @looftapay_bot. Pure and regex-based (no LLM), same
 * approach as apps/twitter-bot/src/parser.ts. Accepted, with or without a leading slash:
 *   send $5 to @alice   pay 5 usdc to alice   /send 5 @alice   /send @alice 5   /tip 5 (as a reply)
 */
export type ParsedSend =
  | { ok: true; amount: number; handle: string | null }
  | { ok: false; error: string };

const AMOUNT = String.raw`\$?(\d+(?:\.\d+)?)`;
const UNIT = String.raw`(?:\s*(?:usdc|usd|dollars?|bucks))?`;
const HANDLE = String.raw`@?([a-z0-9_]{1,40})`;
const VERB = String.raw`\/?(?:send|pay|tip)`;

const AMOUNT_FIRST = new RegExp(`^${VERB}\\s+${AMOUNT}${UNIT}(?:\\s+(?:to\\s+)?${HANDLE})?$`);
const HANDLE_FIRST = new RegExp(`^${VERB}\\s+${HANDLE}\\s+${AMOUNT}${UNIT}$`);

export const TELEGRAM_HANDLE_RE = /^[a-z0-9_]{5,32}$/;
export const MAX_COMMAND_AMOUNT_USD = 500;

export function parseSendCommand(raw: string, botUsername: string): ParsedSend | null {
  const text = raw
    .toLowerCase()
    .replace(new RegExp(`@${botUsername.toLowerCase()}`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();

  let amountStr: string | undefined;
  let handle: string | null = null;

  let m = AMOUNT_FIRST.exec(text);
  if (m) {
    amountStr = m[1];
    handle = m[2] ?? null;
  } else if ((m = HANDLE_FIRST.exec(text))) {
    handle = m[1];
    amountStr = m[2];
  } else {
    return null;
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(amountStr)) {
    return { ok: false, error: 'Amounts can have at most 2 decimals, for example $5 or $2.50.' };
  }
  const amount = Number(amountStr);
  if (!(amount > 0)) return { ok: false, error: 'The amount must be more than $0.' };
  if (amount > MAX_COMMAND_AMOUNT_USD) {
    return { ok: false, error: `The most I can send in one payment is $${MAX_COMMAND_AMOUNT_USD}.` };
  }
  if (handle !== null && !TELEGRAM_HANDLE_RE.test(handle)) {
    return { ok: false, error: `"@${handle}" is not a valid Telegram username (5 to 32 letters, numbers or underscores).` };
  }
  return { ok: true, amount, handle };
}
