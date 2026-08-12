export interface ParsedPayment {
  senderHandle: string   // tweet author's @handle, lowercase
  recipientHandle: string // @handle from tweet text, lowercase
  amountUsd: number
}

/**
 * Matches explicit commands where @looftapay (or the configured bot handle)
 * is immediately followed by "send" or "pay" — no words in between.
 * This prevents the bot from replying to informational tweets like
 * "I used @looftapay to send $5 to @alice".
 *
 *   @looftapay send $5 to @alice          ✓
 *   hey @looftapay send $5.50 to @alice   ✓
 *   @looftapay pay 20 usdc to @bob        ✓
 *   I used @looftapay to send $5 to @alice ✗  (words between bot and "send")
 *
 * Minimum amount: $1. Maximum: $10 000.
 * Handle: 1–50 alphanumeric / underscore chars (Twitter rules).
 */
function buildPaymentRe(botHandle: string): RegExp {
  const escaped = botHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `@${escaped}\\s+(?:send|pay)\\s+\\$?([\\d]+(?:\\.[\\d]{1,2})?)\\$?\\s*(?:usdc|usd|dollars?)?\\s+to\\s+@([a-zA-Z0-9_]{1,50})`,
    'i',
  )
}

const MIN_AMOUNT_USD = 1

export function parseTweet(
  tweetText: string,
  authorHandle: string,
): ParsedPayment | null {
  const botHandle = (process.env.TWITTER_BOT_HANDLE ?? 'looftapay').toLowerCase()
  const PAYMENT_RE = buildPaymentRe(botHandle)
  const match = PAYMENT_RE.exec(tweetText)
  if (!match) return null

  const amount = parseFloat(match[1])
  if (isNaN(amount) || amount < MIN_AMOUNT_USD || amount > 10_000) return null

  const recipient = match[2].toLowerCase()
  const sender = authorHandle.replace(/^@/, '').toLowerCase()

  // Ignore self-payments and payments to the bot itself
  if (recipient === sender) return null
  if (recipient === botHandle) return null

  // Reject tweets that contain significant extra content beyond the command —
  // these are likely informational/explanatory, not actual payment requests.
  // Strip the matched command and all @mentions, then count real words left over.
  const extra = tweetText
    .replace(match[0], '')   // remove the command itself
    .replace(/@\w+/g, '')    // remove any other @mentions
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation & emoji
    .trim()
  const extraWords = extra.split(/\s+/).filter(w => w.length >= 3)
  if (extraWords.length > 4) return null

  return { senderHandle: sender, recipientHandle: recipient, amountUsd: amount }
}

export interface ParsedTicketGift {
  senderHandle: string
  recipientHandle: string
  numTickets: number
}

/**
 * Matches "@looftapay gift N ticket(s) to @handle" / "@looftapay send N tickets to @handle".
 * Deliberately distinct from the payment regex — the required literal "ticket(s)" between the
 * number and "to" means a tweet can only ever match one of the two commands, never both, so
 * callers can safely try payment first then this one with no ambiguity.
 *
 *   @looftapay gift 3 tickets to @alice   ✓
 *   @looftapay send 1 ticket to @bob      ✓
 *   @looftapay send $5 to @alice          ✗ (matches the payment command instead)
 *
 * 1–100 tickets per gift, same cap as the underlying admin-gift endpoint.
 */
function buildTicketGiftRe(botHandle: string): RegExp {
  const escaped = botHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `@${escaped}\\s+(?:gift|send)\\s+([\\d]+)\\s+tickets?\\s+to\\s+@([a-zA-Z0-9_]{1,50})`,
    'i',
  )
}

export function parseTicketGift(
  tweetText: string,
  authorHandle: string,
): ParsedTicketGift | null {
  const botHandle = (process.env.TWITTER_BOT_HANDLE ?? 'looftapay').toLowerCase()
  const TICKET_RE = buildTicketGiftRe(botHandle)
  const match = TICKET_RE.exec(tweetText)
  if (!match) return null

  const numTickets = parseInt(match[1], 10)
  if (isNaN(numTickets) || numTickets < 1 || numTickets > 100) return null

  const recipient = match[2].toLowerCase()
  const sender = authorHandle.replace(/^@/, '').toLowerCase()

  if (recipient === sender) return null
  if (recipient === botHandle) return null

  const extra = tweetText
    .replace(match[0], '')
    .replace(/@\w+/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
  const extraWords = extra.split(/\s+/).filter(w => w.length >= 3)
  if (extraWords.length > 4) return null

  return { senderHandle: sender, recipientHandle: recipient, numTickets }
}
