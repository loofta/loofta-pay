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
const TWITTER_BOT_SECRET   = required('TWITTER_BOT_SECRET')   // shared secret for /twitter-payments
const APP_URL              = process.env.APP_URL ?? 'https://pay.loofta.xyz'
const BOT_HANDLE           = (process.env.TWITTER_BOT_HANDLE ?? 'looftapay').toLowerCase()
const POLL_INTERVAL_MS     = parseInt(process.env.POLL_INTERVAL_MS ?? '180000', 10) // 3 min default
const IS_DEVNET            = process.env.NODE_ENV !== 'production'

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
}): Promise<{ short_id: string; link: string; already_exists?: boolean } | null> {
  try {
    const res = await fetch(`${LOOFTA_API_URL}/twitter-payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TWITTER_BOT_SECRET}`,
      },
      body: JSON.stringify({ ...params, is_devnet: true }), // devnet-only for now; flip to IS_DEVNET when mainnet is ready
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

const replies = [
  `@${parsed.senderHandle} ready to finalize this ${amountDisplay} devnet USDC payment to @${parsed.recipientHandle}?\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} does everything look good for this devnet payment to @${parsed.recipientHandle}?\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} want to complete this ${amountDisplay} transfer to @${parsed.recipientHandle} on devnet?\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} your devnet USDC payment for @${parsed.recipientHandle} is ready — finalize it here?\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} is this the correct payment for @${parsed.recipientHandle}?\nYou can finalize it here:\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} everything set for this devnet transfer to @${parsed.recipientHandle}?\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} ready to continue with this payment to @${parsed.recipientHandle}?\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} can you confirm this ${amountDisplay} devnet USDC payment to @${parsed.recipientHandle}?\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} your payment request for @${parsed.recipientHandle} is ready.\nWould you like to finalize it?\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} want to review and complete this devnet payment for @${parsed.recipientHandle}?\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} this ${amountDisplay} devnet transaction to @${parsed.recipientHandle} is ready.\nFinalize it here?\n${APP_URL}/tw/${payment.short_id}`,

  `@${parsed.senderHandle} does this devnet USDC transfer to @${parsed.recipientHandle} look correct?\n${APP_URL}/tw/${payment.short_id}`,
]
  const replyText = replies[Math.floor(Math.random() * replies.length)]

  try {
    await twitter.v2.reply(replyText, tweet.id)
    console.log(`[bot] replied to tweet ${tweet.id} with link ${payment.short_id}`)
  } catch (err) {
    console.error(`[bot] failed to reply to tweet ${tweet.id}:`, err)
  }
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
