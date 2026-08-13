import { config } from 'dotenv'
import { resolve } from 'path'
// Load .env.local for local dev (Railway injects vars directly in prod)
config({ path: resolve(__dirname, '..', '.env.local') })

import { TwitterApi, type TweetV2 } from 'twitter-api-v2'
import { parseTweet, parseTicketGift } from './parser'

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
// Seeded from the backend on startup (see loadPollCursor) — process.env.SINCE_TWEET_ID is only
// a manual override for local testing, not the normal source of truth anymore.
let lastSeenTweetId: string | undefined = process.env.SINCE_TWEET_ID
let enrolledHandles = new Set<string>()

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

async function createTicketGiftRequest(params: {
  sender_twitter: string
  recipient_twitter: string
  num_tickets: number
  tweet_id: string
  tweet_url: string
}): Promise<{ short_id: string; link: string; already_exists?: boolean; delivered_instantly?: boolean } | null> {
  try {
    const res = await fetch(`${LOOFTA_API_URL}/twitter-ticket-gifts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LOOFTA_INTEGRATOR_API_KEY}`,
      },
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[loofta] create ticket gift failed ${res.status}: ${body}`)
      return null
    }
    return res.json()
  } catch (err) {
    console.error('[loofta] network error creating ticket gift:', err)
    return null
  }
}

// ─── Enrollment pre-filter + poll cursor persistence ─────────────────────────
// Fetched fresh each poll cycle rather than cached indefinitely — enrollment changes (someone
// enables/disables via /app/twitter-bot) should take effect on the next poll, not require a
// bot restart.
async function fetchEnrolledHandles(): Promise<Set<string>> {
  try {
    const res = await fetch(`${LOOFTA_API_URL}/twitter-autopay/enrolled-handles`, {
      headers: { Authorization: `Bearer ${LOOFTA_INTEGRATOR_API_KEY}` },
    })
    if (!res.ok) {
      console.error(`[loofta] failed to fetch enrolled handles ${res.status} — keeping previous list`)
      return enrolledHandles
    }
    const data = await res.json() as { handles: string[] }
    return new Set(data.handles.map((h) => h.toLowerCase()))
  } catch (err) {
    console.error('[loofta] network error fetching enrolled handles — keeping previous list:', err)
    return enrolledHandles
  }
}

async function loadPollCursor(): Promise<void> {
  if (lastSeenTweetId) return // env override already set, don't clobber it
  try {
    const res = await fetch(`${LOOFTA_API_URL}/twitter-autopay/poll-cursor?bot_handle=${encodeURIComponent(BOT_HANDLE)}`, {
      headers: { Authorization: `Bearer ${LOOFTA_INTEGRATOR_API_KEY}` },
    })
    if (!res.ok) {
      console.error(`[loofta] failed to load poll cursor ${res.status} — starting from current mentions`)
      return
    }
    const data = await res.json() as { last_seen_tweet_id: string | null }
    if (data.last_seen_tweet_id) {
      lastSeenTweetId = data.last_seen_tweet_id
      console.log(`[bot] resumed poll cursor from backend: ${lastSeenTweetId}`)
    }
  } catch (err) {
    console.error('[loofta] network error loading poll cursor — starting from current mentions:', err)
  }
}

async function savePollCursor(tweetId: string): Promise<void> {
  try {
    const res = await fetch(`${LOOFTA_API_URL}/twitter-autopay/poll-cursor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOOFTA_INTEGRATOR_API_KEY}` },
      body: JSON.stringify({ bot_handle: BOT_HANDLE, last_seen_tweet_id: tweetId }),
    })
    if (!res.ok) console.error(`[loofta] failed to save poll cursor ${res.status}`)
  } catch (err) {
    console.error('[loofta] network error saving poll cursor:', err)
  }
}

// ─── Process a single mention tweet ──────────────────────────────────────────
async function processTweet(tweet: TweetV2, authorHandle: string): Promise<void> {
  const tweetUrl = `https://x.com/${authorHandle}/status/${tweet.id}`

  const ticketGift = parseTicketGift(tweet.text, authorHandle)
  if (ticketGift) {
    await processTicketGiftTweet(tweet, ticketGift, tweetUrl)
    return
  }

  const parsed = parseTweet(tweet.text, authorHandle)
  if (!parsed) {
    console.log(`[bot] skipped tweet ${tweet.id} — no payment or ticket-gift pattern matched`)
    return
  }

  console.log(
    `[bot] matched: @${parsed.senderHandle} → $${parsed.amountUsd} → @${parsed.recipientHandle} (tweet ${tweet.id})`,
  )

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

async function processTicketGiftTweet(
  tweet: TweetV2,
  parsed: { senderHandle: string; recipientHandle: string; numTickets: number },
  tweetUrl: string,
): Promise<void> {
  console.log(
    `[bot] matched ticket gift: @${parsed.senderHandle} → ${parsed.numTickets} ticket(s) → @${parsed.recipientHandle} (tweet ${tweet.id})`,
  )

  const gift = await createTicketGiftRequest({
    sender_twitter: parsed.senderHandle,
    recipient_twitter: parsed.recipientHandle,
    num_tickets: parsed.numTickets,
    tweet_id: tweet.id,
    tweet_url: tweetUrl,
  })

  if (!gift) {
    console.error(`[bot] failed to create ticket gift for tweet ${tweet.id}`)
    return
  }

  if (gift.already_exists) {
    console.log(`[bot] tweet ${tweet.id} already processed — skipping reply`)
    return
  }

  // gift.link is already the right destination either way — the backend picks between our
  // own /tw/:short_id confirmation (instant delivery) and the existing lottery gift claim page
  // (recipient not registered yet), see TwitterTicketGiftsService.create().
  const replyText = composeTicketGiftReply(parsed.senderHandle, parsed.recipientHandle, parsed.numTickets, gift.link, !!gift.delivered_instantly)

  try {
    await twitter.v2.reply(replyText, tweet.id)
    console.log(`[bot] replied to tweet ${tweet.id} with ticket gift link ${gift.short_id}`)
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

// Neutral, declarative — no CTA verbs ("confirm", "click", "complete", "want to", "ready to").
// This path only fires when auto-pay didn't execute (unenrolled sender, or a transient auto-pay
// failure), so it can't claim the money already moved — but it also shouldn't read as a directive
// to click a link, which is the exact pattern that reads as solicitation at any reply volume.
function composeReply(sender: string, recipient: string, amount: string, link: string): string {
  const openers = [
    (s: string, r: string, a: string) => `@${s} → @${r}: ${a} pending.`,
    (s: string, r: string, a: string) => `${a} from @${s} to @${r} is open.`,
    (s: string, r: string, a: string) => `a ${a} request between @${s} and @${r} is waiting.`,
    (s: string, r: string, a: string) => `@${r}, there's a ${a} request from @${s}.`,
    (s: string, r: string, a: string) => `${a}, @${s} to @${r} — pending.`,
  ]
  const closers = [
    (l: string) => `\n${l}`,
    (l: string) => ` ${l}`,
    (l: string) => `\ndetails: ${l}`,
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

// Ticket gifts are always instant-or-claim, never "come back and confirm" — so this only ever
// speaks in the past/imperative-done register, same principle as composeFundedReply.
function composeTicketGiftReply(sender: string, recipient: string, numTickets: number, link: string, deliveredInstantly: boolean): string {
  const ticketWord = numTickets === 1 ? 'ticket' : 'tickets'
  if (deliveredInstantly) {
    const openers = [
      (s: string, r: string, n: number) => `sent @${r} ${n} lottery ${ticketWord} on @${s}'s behalf.`,
      (s: string, r: string, n: number) => `@${r}, @${s} just gifted you ${n} ${ticketWord}.`,
      (s: string, r: string, n: number) => `gifted ${n} ${ticketWord} to @${r}, from @${s}.`,
      (s: string, r: string, n: number) => `done, @${r} just got ${n} ${ticketWord} courtesy of @${s}.`,
    ]
    const closers = [
      (l: string) => `\nsee it here: ${l}`,
      (l: string) => `\n${l}`,
      (l: string) => ` ${l}`,
    ]
    return pick(openers)(sender, recipient, numTickets) + pick(closers)(link)
  }
  const openers = [
    (s: string, r: string, n: number) => `@${s} gifted @${r} ${n} lottery ${ticketWord}.`,
    (s: string, r: string, n: number) => `${n} ${ticketWord} waiting for @${r}, from @${s}.`,
    (s: string, r: string, n: number) => `@${r}, @${s} sent you ${n} ${ticketWord} to claim.`,
  ]
  const closers = [
    (l: string) => `\nclaim them here: ${l}`,
    (l: string) => `\n${l}`,
  ]
  return pick(openers)(sender, recipient, numTickets) + pick(closers)(link)
}

// ─── Poll mentions ────────────────────────────────────────────────────────────
async function pollMentions(botUserId: string): Promise<void> {
  console.log(`[bot] polling mentions… (since_id: ${lastSeenTweetId ?? 'none'})`)

  // Refreshed every cycle — enable/disable via /app/twitter-bot takes effect on the next poll.
  enrolledHandles = await fetchEnrolledHandles()

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

    // Newest tweet first — persist since_id to the backend so a restart doesn't forget it and
    // re-scan this same batch (harmless — tweet_id dedup prevents any double-reply — but noisy
    // and wastes API quota).
    lastSeenTweetId = tweets[0].id
    await savePollCursor(lastSeenTweetId)

    let skippedNotEnrolled = 0

    // Process oldest → newest so replies appear in order
    for (const tweet of [...tweets].reverse()) {
      // Skip retweets
      const isRetweet = tweet.referenced_tweets?.some((r) => r.type === 'retweeted')
      if (isRetweet) continue

      // Skip the bot's own tweets
      const authorHandle = users[tweet.author_id ?? '']
      if (!authorHandle || authorHandle.toLowerCase() === BOT_HANDLE) continue

      // Enrollment pre-filter — skip before even trying to parse the tweet text, instead of
      // parsing every mention and only finding out at create() time that the sender isn't
      // authorized. Counted and logged once per poll rather than per-tweet to keep logs quiet.
      if (!enrolledHandles.has(authorHandle.toLowerCase())) {
        skippedNotEnrolled++
        continue
      }

      await processTweet(tweet, authorHandle)

      // Jittered pacing between replies — a mention backlog processed back-to-back would post
      // several replies in the same few seconds, a burst signal independent of any rate limit.
      await sleep(3000 + Math.random() * 4000)
    }

    if (skippedNotEnrolled > 0) {
      console.log(`[bot] ignored ${skippedNotEnrolled} mention(s) from non-enrolled account(s)`)
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

  // Resume the mention-timeline cursor from the backend, so a Railway restart doesn't re-scan
  // a batch of already-seen mentions from scratch.
  await loadPollCursor()

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
