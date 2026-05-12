export interface ParsedPayment {
  senderHandle: string   // tweet author's @handle, lowercase
  recipientHandle: string // @handle from tweet text, lowercase
  amountUsd: number
}

/**
 * Matches patterns like:
 *   @looftapay send $5 to @alice
 *   @looftapay send 5$ to @alice
 *   @looftapay send $5.50 to @alice
 *   @looftapay pls send $10 to @bob
 *   hey @looftapay send 20 to @carol 🙏
 *   @looftapay send 5 usdc to @dave
 *
 * Amount: 0.01 – 10000 USD
 * Handle: 1–50 alphanumeric / underscore chars (Twitter rules)
 */
const PAYMENT_RE =
  /send\s+\$?([\d]+(?:\.[\d]{1,2})?)\$?\s*(?:usdc|usd|dollars?)?\s+to\s+@([a-zA-Z0-9_]{1,50})/i

export function parseTweet(
  tweetText: string,
  authorHandle: string,
): ParsedPayment | null {
  const match = PAYMENT_RE.exec(tweetText)
  if (!match) return null

  const amount = parseFloat(match[1])
  if (isNaN(amount) || amount < 0.5 || amount > 10_000) return null

  const recipient = match[2].toLowerCase()
  const sender = authorHandle.replace(/^@/, '').toLowerCase()

  // Ignore self-payments
  if (recipient === sender) return null

  // Ignore payments to the bot itself
  const botHandle = (process.env.TWITTER_BOT_HANDLE ?? 'looftapay').toLowerCase()
  if (recipient === botHandle) return null

  return { senderHandle: sender, recipientHandle: recipient, amountUsd: amount }
}
