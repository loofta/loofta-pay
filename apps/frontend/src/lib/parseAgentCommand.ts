/**
 * Free-text "send $5 to @alice on X" style parser for the AI agent chat box. Deliberately
 * regex-based (no LLM call) — mirrors apps/twitter-bot/src/parser.ts's approach for the same
 * kind of command, generalized to accept any platform keyword instead of assuming X/Twitter.
 *
 * Supports two multi-recipient shapes:
 *  - Shared: "send $5 to @a, @b, @c on X" — one amount + one platform applied to every recipient.
 *  - Per-recipient: "send $100 to @a on X, @b on telegram" or "$5 to @a on X and $10 to @b on
 *    telegram" — each clause can carry its own amount/platform; a clause missing either inherits
 *    the nearest previously-stated value (natural reading of "and $10 to @b" implying "on X" too
 *    if no platform is repeated).
 */

export type AgentRecipientPlatform = "email" | "twitter" | "telegram" | "discord" | "github" | "username";

export interface ParsedRecipient {
  /** As typed, e.g. "@alice" */
  raw: string;
  platform: AgentRecipientPlatform;
  /** Cleaned handle/email, no leading "@". */
  identifier: string;
  /** This recipient's own amount — always populated (shared amount is copied onto every recipient). */
  amount: number;
}

export interface ParsedSendCommand {
  recipients: ParsedRecipient[];
  isMulti: boolean;
  isPrivate: boolean;
  error?: string;
}

const PLATFORM_KEYWORDS: Record<string, AgentRecipientPlatform> = {
  x: "twitter",
  twitter: "twitter",
  telegram: "telegram",
  tg: "telegram",
  discord: "discord",
  github: "github",
  loofta: "username",
  username: "username",
};

const FILLER_TOKENS = new Set([
  "them", "everyone", "all", "these", "this", "each", "someone", "somebody",
  "users", "user", "people", "folks", "handles", "accounts",
  "something", "anything", "money", "funds", "cash",
]);

const PLATFORM_ALTERNATION = "x|twitter|telegram|tg|discord|github|loofta|username";
const ON_PLATFORM_RE = new RegExp(`\\bon\\s+(${PLATFORM_ALTERNATION})\\b`, "i");
const ON_PLATFORM_RE_G = new RegExp(`\\bon\\s+(${PLATFORM_ALTERNATION})\\b`, "gi");
const AMOUNT_RE = /\$\s?(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s?\$|\b(\d+(?:\.\d{1,2})?)\b(?=\s*(?:usdc\b|usd\b|dollars?\b)|)/i;
// Counts amount tokens specifically followed by "to" — the clause-boundary signal ("$5 to @a")
// distinct from a bare number that could be part of a handle like "alice2".
const AMOUNT_BEFORE_TO_RE_G = /\d+(?:\.\d{1,2})?\s?\$?\s*(?:usdc|usd|dollars?)?\s*(?:to|tp)\b/gi;

function detectPlatformKeyword(text: string): AgentRecipientPlatform | null {
  const onMatch = text.match(ON_PLATFORM_RE);
  if (onMatch) return PLATFORM_KEYWORDS[onMatch[1].toLowerCase()] ?? null;
  // "these telegram users", "my discord users" — platform named without "on", common in casual phrasing.
  const usersMatch = text.match(/\b(x|twitter|telegram|tg|discord|github)\s+users?\b/i);
  return usersMatch ? PLATFORM_KEYWORDS[usersMatch[1].toLowerCase()] ?? null : null;
}

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** A clean handle/username/email — no internal whitespace, so stray phrases like
 *  "telegram users something" never get treated as a real recipient. */
function looksLikeHandle(s: string): boolean {
  return /^@?[a-z0-9_.+-]+$/i.test(s) || looksLikeEmail(s);
}

function extractAmount(text: string): number | null {
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  const value = m[1] ?? m[2] ?? m[3];
  return value ? parseFloat(value) : null;
}

/** Strips the send/pay verb, "private(ly)", and leading "to"/"all" filler from one clause,
 *  leaving just the recipient token(s) — the same cleanup the old single-clause parser did,
 *  factored out so it can run once over the whole command or once per split-out clause. */
function stripToRecipientPart(text: string): string {
  return text
    .replace(ON_PLATFORM_RE, "")
    .replace(/\b(x|twitter|telegram|tg|discord|github)\s+users?\b/i, "")
    .replace(/\bprivate(ly)?\b/i, "")
    .replace(/^\s*(send|pay)\b/i, "")
    .replace(/\$\s?\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s?\$|\b\d+(?:\.\d{1,2})?\s?(?:usdc|usd|dollars?)\b|\b\d+(?:\.\d{1,2})?\b/i, "")
    .replace(/^\s*(to|tp|all(?:\s+(?:this|these))?)\s*/i, "")
    .replace(/^[:\s]+/, "")
    .trim();
}

function toRecipient(rawToken: string, platform: AgentRecipientPlatform | null, amount: number): ParsedRecipient {
  const cleaned = rawToken.replace(/^@/, "").trim();
  let recipientPlatform: AgentRecipientPlatform = platform ?? "username";
  if (!platform && looksLikeEmail(cleaned)) recipientPlatform = "email";
  return {
    raw: rawToken,
    platform: recipientPlatform,
    identifier: cleaned.toLowerCase(),
    amount,
  };
}

/** Splits into top-level clauses on commas / "and", each parsed independently for its own
 *  amount + platform + recipient — used when the command clearly names more than one amount or
 *  more than one platform (the shared-list case below handles the simpler "$5 to @a, @b on X"). */
function parseHeterogeneousClauses(text: string, sharedPlatformFallback: AgentRecipientPlatform | null): ParsedRecipient[] {
  const withoutVerb = text.replace(/^\s*(send|pay)\b/i, "").replace(/\bprivate(ly)?\b/i, "");
  const clauses = withoutVerb
    .split(/,|\band\b/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const parsedClauses = clauses.map((clause) => ({
    amount: extractAmount(clause),
    platform: detectPlatformKeyword(clause),
    recipientToken: stripToRecipientPart(clause),
  }));

  const defaultAmount = parsedClauses.map((c) => c.amount).find((a) => a !== null) ?? null;
  const defaultPlatform = parsedClauses.map((c) => c.platform).find((p) => p !== null) ?? sharedPlatformFallback;

  const recipients: ParsedRecipient[] = [];
  for (const c of parsedClauses) {
    const token = c.recipientToken.replace(/^@/, "").trim();
    if (!token || !looksLikeHandle(token) || FILLER_TOKENS.has(token.toLowerCase())) continue;
    const amount = c.amount ?? defaultAmount;
    if (amount === null || amount <= 0) continue;
    recipients.push(toRecipient(c.recipientToken.trim(), c.platform ?? defaultPlatform, amount));
  }
  return recipients;
}

export function parseAgentCommand(input: string): ParsedSendCommand {
  const text = input.trim();
  if (!text) {
    return { recipients: [], isMulti: false, isPrivate: false, error: 'Type a command, e.g. "send $5 to @alice on X".' };
  }

  const isPrivate = /\bprivate(ly)?\b/i.test(text);
  const platformMentions = (text.match(ON_PLATFORM_RE_G) || []).length;
  const amountMentions = (text.match(AMOUNT_BEFORE_TO_RE_G) || []).length;
  const looksHeterogeneous = platformMentions >= 2 || amountMentions >= 2;

  let recipients: ParsedRecipient[];

  if (looksHeterogeneous) {
    const platform = detectPlatformKeyword(text);
    recipients = parseHeterogeneousClauses(text, platform);
  } else {
    const amount = extractAmount(text);
    const platform = detectPlatformKeyword(text);
    const recipientPart = stripToRecipientPart(text);

    const rawRecipients = recipientPart
      .split(/,|;|\band\b/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !FILLER_TOKENS.has(s.toLowerCase()))
      .filter(looksLikeHandle);

    recipients = amount !== null && amount > 0 ? rawRecipients.map((r) => toRecipient(r, platform, amount)) : [];
  }

  const isMulti = recipients.length > 1;

  if (recipients.length === 0) {
    return {
      recipients: [],
      isMulti: false,
      isPrivate,
      error: 'I couldn\'t find a recipient with an amount. Try "send $5 to @alice on X" or "send $10 to alice@email.com".',
    };
  }

  return { recipients, isMulti, isPrivate };
}
