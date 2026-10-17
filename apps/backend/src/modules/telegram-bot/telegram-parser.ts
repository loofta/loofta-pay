/**
 * Parses a payment command typed to @looftapay_bot. Pure and regex-based (no LLM), same
 * approach as apps/twitter-bot/src/parser.ts. `pay` and `send` are interchangeable, with or
 * without a leading slash, and the amount may carry the dollar sign on either side:
 *   pay $5 to @someone      send 5$ to @someone      /pay 5 @someone      /pay 5 (as a reply)
 *   send 5$ privately to @someone      pay 5 private @someone      /payprivately 5 @someone
 *   pay 5 privately to @someone delay 30m split 4
 */
export type ParsedSend =
  | {
      ok: true;
      amount: number;
      handle: string | null;
      isPrivate: boolean;
      /** Max delivery delay in ms for a private payment; null = default (10 minutes). */
      delayMs: number | null;
      /** Number of private transfer parts (1-15); null = random. */
      split: number | null;
    }
  | { ok: false; error: string };

const AMOUNT = String.raw`\$?(\d+(?:\.\d+)?)\$?`;
const UNIT = String.raw`(?:\s*(?:usdc|usd|dollars?|bucks))?`;
const HANDLE = String.raw`@?([a-z0-9_]{1,40})`;
const VERB = String.raw`\/?(?:pay|send)`;

const AMOUNT_FIRST = new RegExp(`^${VERB}\\s+${AMOUNT}${UNIT}(?:\\s+(?:to\\s+)?${HANDLE})?$`);
const HANDLE_FIRST = new RegExp(`^${VERB}\\s+${HANDLE}\\s+${AMOUNT}${UNIT}$`);

export const TELEGRAM_HANDLE_RE = /^[a-z0-9_]{5,32}$/;
export const MAX_COMMAND_AMOUNT_USD = 500;
export const MIN_PRIVATE_AMOUNT_USD = 1;
export const DEFAULT_PRIVATE_DELAY_MS = 10 * 60 * 1000;
export const MIN_PRIVATE_DELAY_MS = 60 * 1000;
export const MAX_PRIVATE_DELAY_MS = 24 * 60 * 60 * 1000;

const PRIVATE_RE = /\b(?:privately|private|privatly)\b/;
const DELAY_RE = /\bdelay\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)?\b/;
const SPLIT_RE = /\bsplit\s+(\d+|random)\b/;

function delayToMs(value: number, unit: string | undefined): number {
  const u = unit ?? 'm';
  if (u.startsWith('s')) return Math.round(value * 1000);
  if (u.startsWith('h')) return Math.round(value * 3_600_000);
  return Math.round(value * 60_000);
}

export function parseSendCommand(raw: string, botUsername: string): ParsedSend | null {
  let text = raw
    .toLowerCase()
    .replace(new RegExp(`@${botUsername.toLowerCase()}`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();

  // /payprivately, /pay_privately, /sendprivately (and "private") are the private forms of pay/send.
  text = text.replace(/^(\/?)(pay|send)_?(privately|private)\b/, '$1$2 privately');

  // Only treat the message as a payment if it starts like one. The private options are pulled out
  // afterwards so they can sit anywhere after the verb.
  if (!new RegExp(`^${VERB}\\b`).test(text)) return null;

  const isPrivate = PRIVATE_RE.test(text);
  text = text.replace(PRIVATE_RE, ' ');

  let delayMs: number | null = null;
  const d = DELAY_RE.exec(text);
  if (d) {
    delayMs = delayToMs(Number(d[1]), d[2]);
    text = text.replace(DELAY_RE, ' ');
  }

  let split: number | null = null;
  const sp = SPLIT_RE.exec(text);
  if (sp) {
    split = sp[1] === 'random' ? null : Number(sp[1]);
    text = text.replace(SPLIT_RE, ' ');
  }

  text = text.replace(/\s+/g, ' ').trim();

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

  if (!isPrivate && (d || (sp && sp[1] !== 'random'))) {
    return { ok: false, error: 'Delay and split only apply to private payments. Add the word "privately", for example: pay 5 privately to @someone delay 30m split 4.' };
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountStr)) {
    return { ok: false, error: 'Amounts can have at most 2 decimals, for example $5 or $2.50.' };
  }
  const amount = Number(amountStr);
  if (!(amount > 0)) return { ok: false, error: 'The amount must be more than $0.' };
  if (amount > MAX_COMMAND_AMOUNT_USD) {
    return { ok: false, error: `The most I can send in one payment is $${MAX_COMMAND_AMOUNT_USD}.` };
  }
  if (isPrivate && amount < MIN_PRIVATE_AMOUNT_USD) {
    return { ok: false, error: `Private payments start at $${MIN_PRIVATE_AMOUNT_USD}.` };
  }
  if (handle !== null && !TELEGRAM_HANDLE_RE.test(handle)) {
    return { ok: false, error: `"@${handle}" is not a valid Telegram username (5 to 32 letters, numbers or underscores).` };
  }
  if (delayMs !== null && (delayMs < MIN_PRIVATE_DELAY_MS || delayMs > MAX_PRIVATE_DELAY_MS)) {
    return { ok: false, error: 'The delay must be between 1 minute and 24 hours, for example delay 30m or delay 2h.' };
  }
  if (split !== null && (!Number.isInteger(split) || split < 1 || split > 15)) {
    return { ok: false, error: 'Split must be a number from 1 to 15, or "random".' };
  }
  return { ok: true, amount, handle, isPrivate, delayMs, split };
}
