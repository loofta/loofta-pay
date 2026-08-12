import { config } from 'dotenv'
import { resolve } from 'path'
// Load .env.local for local dev (Railway injects vars directly in prod)
config({ path: resolve(__dirname, '..', '.env.local') })

import { TwitterApi, type TweetV2 } from 'twitter-api-v2'
import { parseTweet } from './parser'

// ─── Config ───────────────────────────────────────────────────────────────────
function required(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

const TWITTER_API_KEY      = required('TWITTER_API_KEY')
const TWITTER_API_SECRET   = required('TWITTER_API_SECRET')
const TWITTER_ACCESS_TOKEN = required('TWITTER_ACCESS_TOKEN')
const TWITTER_ACCESS_SECRET = required('TWITTER_ACCESS_SECRET')
const LOOFTA_API_URL       = required('LOOFTA_API_URL')       // e.g. https://api.loofta.xyz
// Per-integrator API key (see apps/backend/src/modules/integrators) — replaces the old shared,
// static TWITTER_BOT_SECRET/BotGuard so this bot has its own revocable, rate-limited identity
// instead of one secret shared by anything that ever needed bot-like auth.
const LOOFTA_INTEGRATOR_API_KEY = required('LOOFTA_INTEGRATOR_API_KEY')
const APP_URL              = process.env.APP_URL ?? 'https://pay.loofta.xyz'
const BOT_HANDLE           = (process.env.TWITTER_BOT_HANDLE ?? 'looftapay').toLowerCase()
const POLL_INTERVAL_MS     = parseInt(process.env.POLL_INTERVAL_MS ?? '180000', 10) // 3 min default

// ─── Twitter client ───────────────────────────────────────────────────────────
const twitter = new TwitterApi({
  appKey: TWITTER_API_KEY,
  appSecret: TWITTER_API_SECRET,
  accessToken: TWITTER_ACCESS_TOKEN,
  accessSecret: TWITTER_ACCESS_SECRET,
})

// ─── State ────────────────────────────────────────────────────────────────────
let lastSeenTweetId: string | undefined = process.env.SINCE_TWEET_ID

// ─── Loofta API ───────────────────────────────────────────────────────────────
async function createPaymentRequest(params: {
  sender_twitter: string
  recipient_twitter: string
  amount_usd: number
  tweet_id: string
  tweet_url: string
}): Promise<{ short_id: string; link: string; already_exists?: boolean; funded?: boolean; status?: string } | null> {
  try {
    const res = await fetch(`${LOOFTA_API_URL}/twitter-payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LOOFTA_INTEGRATOR_API_KEY}`,
      },
      // is_devnet intentionally omitted — the backend derives it from this bot's own integrator
      // row (is_devnet_only) unless explicitly overridden here. Mainnet cutover = flipping that
      // integrator's flag via the admin endpoint, not a bot-side env change.
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[loofta] create payment failed ${res.status}: ${body}`)
      return null
    }
    return res.json()
  } catch (err) {
    console.error('[loofta] network error creating payment:', err)
    return null
  }
}

// ─── Process a single mention tweet ──────────────────────────────────────────
async function processTweet(tweet: TweetV2, authorHandle: string): Promise<void> {
  const parsed = parseTweet(tweet.text, authorHandle)
  if (!parsed) {
    console.log(`[bot] skipped tweet ${tweet.id} — no payment pattern matched`)
    return
  }

  console.log(
    `[bot] matched: @${parsed.senderHandle} → $${parsed.amountUsd} → @${parsed.recipientHandle} (tweet ${tweet.id})`,
  )

  const tweetUrl = `https://x.com/${authorHandle}/status/${tweet.id}`
  const payment = await createPaymentRequest({
    sender_twitter: parsed.senderHandle,
    recipient_twitter: parsed.recipientHandle,
    amount_usd: parsed.amountUsd,
    tweet_id: tweet.id,
    tweet_url: tweetUrl,
  })

  if (!payment) {
    console.error(`[bot] failed to create payment for tweet ${tweet.id}`)
    return
  }

  if (payment.already_exists) {
    console.log(`[bot] tweet ${tweet.id} already processed — skipping reply`)
    return
  }

  const amountDisplay =
    parsed.amountUsd % 1 === 0
      ? `$${parsed.amountUsd}`
      : `$${parsed.amountUsd.toFixed(2)}`

  const link = `${APP_URL}/tw/${payment.short_id}`
  const replyText = payment.funded
    ? composeFundedReply(parsed.senderHandle, parsed.recipientHandle, amountDisplay, link)
    : composeReply(parsed.senderHandle, parsed.recipientHandle, amountDisplay, link)

  try {
    await twitter.v2.reply(replyText, tweet.id)
    console.log(`[bot] replied to tweet ${tweet.id} with link ${payment.short_id}`)
  } catch (err) {
    console.error(`[bot] failed to reply to tweet ${tweet.id}:`, err)
  }
}

// ─── Reply composer ───────────────────────────────────────────────────────────
// Fragment-based rather than a flat template list: independently randomizing opener/closer
// produces far more structurally distinct output than word-swapping a fixed set of full
// sentences ever could, and mixes declarative phrasing in with questions instead of every
// reply being a "ready to...?" — X's platform-manipulation flag was likely driven by replies
// that, while not literally identical, all shared the same shape and closing-link pattern.
// "devnet" deliberately doesn't appear here — the /tw/[short_id] page already discloses it,
// so repeating it in every reply just adds another fixed, repeated substring across the account.
function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function composeReply(sender: string, recipient: string, amount: string, link: string): string {
  const openers = [
    (s: string, r: string, a: string) => `@${s} ready to send ${a} to @${r}?`,
    (s: string, r: string, a: string) => `@${s} confirm this ${a} payment to @${r} here.`,
    (s: string, r: string, a: string) => `@${s} your ${a} request to @${r} is ready.`,
    (s: string, r: string, a: string) => `@${s} one click to send ${a} to @${r}.`,
    (s: string, r: string, a: string) => `@${s} ${a} to @${r}, ready when you are.`,
    (s: string, r: string, a: string) => `@${s} does this ${a} payment to @${r} look right?`,
    (s: string, r: string, a: string) => `@${s} finish sending ${a} to @${r} here.`,
    (s: string, r: string, a: string) => `@${s} want to complete this ${a} transfer to @${r}?`,
  ]
  const closers = [
    (l: string) => `\n${l}`,
    (l: string) => ` ${l}`,
    (l: string) => `\nfinish it here: ${l}`,
    (l: string) => `\n${l} (takes a few seconds)`,
  ]
  return pick(openers)(sender, recipient, amount) + pick(closers)(link)
}

// Used when the sender is enrolled in auto-pay and the payment already went through — past
// tense, confirming a completed action rather than asking the sender to come finish one. Every
// reply in this register corresponds to money that has actually moved, not a pending invitation.
function composeFundedReply(sender: string, recipient: string, amount: string, link: string): string {
  const openers = [
    (s: string, r: string, a: string) => `sent ${a} to @${r} on @${s}'s behalf.`,
    (s: string, r: string, a: string) => `@${s}'s ${a} to @${r} just went through.`,
    (s: string, r: string, a: string) => `${a} sent to @${r}, on its way.`,
    (s: string, r: string, a: string) => `done, ${a} to @${r} from @${s}.`,
    (s: string, r: string, a: string) => `@${r}, @${s} just sent you ${a}.`,
    (s: string, r: string, a: string) => `paid @${r} ${a} on @${s}'s behalf.`,
  ]
  const closers = [
    (l: string) => `\nclaim it here: ${l}`,
    (l: string) => `\n${l}`,
    (l: string) => ` ${l}`,
  ]
  return pick(openers)(sender, recipient, amount) + pick(closers)(link)
}

// ─── Poll mentions ────────────────────────────────────────────────────────────
async function pollMentions(botUserId: string): Promise<void> {
  console.log(`[bot] polling mentions… (since_id: ${lastSeenTweetId ?? 'none'})`)

  try {
    const timeline = await twitter.v2.userMentionTimeline(botUserId, {
      ...(lastSeenTweetId ? { since_id: lastSeenTweetId } : {}),
      max_results: 100,
      'tweet.fields': ['author_id', 'text', 'referenced_tweets', 'created_at'],
      expansions: ['author_id'],
      'user.fields': ['username'],
    })

    const tweets = timeline.data.data ?? []
    const users: Record<string, string> = {}
    for (const u of timeline.data.includes?.users ?? []) {
      users[u.id] = u.username
    }

    if (tweets.length === 0) {
      console.log('[bot] no new mentions')
      return
    }

    console.log(`[bot] ${tweets.length} new mention(s)`)

    // Newest tweet first — update since_id to the most recent
    lastSeenTweetId = tweets[0].id

    // Process oldest → newest so replies appear in order
    for (const tweet of [...tweets].reverse()) {
      // Skip retweets
      const isRetweet = tweet.referenced_tweets?.some((r) => r.type === 'retweeted')
      if (isRetweet) continue

      // Skip the bot's own tweets
      const authorHandle = users[tweet.author_id ?? '']
      if (!authorHandle || authorHandle.toLowerCase() === BOT_HANDLE) continue

      await processTweet(tweet, authorHandle)

      // Jittered pacing between replies — a mention backlog processed back-to-back would post
      // several replies in the same few seconds, a burst signal independent of any rate limit.
      await sleep(3000 + Math.random() * 4000)
    }
  } catch (err: any) {
    // Twitter rate limit — back off gracefully
    if (err?.code === 429 || err?.status === 429) {
      console.warn('[bot] rate limited by Twitter — backing off 15 min')
      await sleep(15 * 60 * 1000)
      return
    }
    console.error('[bot] error polling mentions:', err)
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`[bot] starting @${BOT_HANDLE} — polling every ${POLL_INTERVAL_MS / 1000}s`)

  // Resolve bot user ID once
  const botUser = await twitter.v2.userByUsername(BOT_HANDLE)
  const botUserId = botUser.data.id
  console.log(`[bot] resolved user ID: ${botUserId}`)

  // Initial poll on startup
  await pollMentions(botUserId)

  // Recurring poll
  setInterval(() => pollMentions(botUserId), POLL_INTERVAL_MS)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

main().catch((err) => {
  console.error('[bot] fatal startup error:', err)
  process.exit(1)
})
