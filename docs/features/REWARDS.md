# Rewards

Backend module: `apps/backend/src/modules/rewards`, exposed via `rewards.controller.ts`
(`GET /rewards/{campaign}/me`, admin `GET /rewards/admin/{campaign}`).

## Blink campaign

`rewards/blink-campaign.service.ts`, surfaced in admin `BlinkTab.tsx` and
`api/admin/blink-campaign/route.ts`.

- **Window**: 2026-07-02T12:00Z – 2026-08-15T00:00Z (hardcoded consts).
- **3 quests**: `setup_passkeys` (inferred from ≥1 Blink deposit — "can't deposit without
  setting up passkeys first"), `two_deposits` (≥2 completed Blink deposits, min $5 each),
  `two_private_payments` (≥2 mainnet private Loofta payments, min $5 each). `qualified` = all
  three complete.
- Blink deposit lookup is a **live external API call** to `api.blink.cash`, authenticated via a
  custom RSA-signed `X-Merchant-Authorization` header (`BLINK_MERCHANT_ID`/
  `BLINK_MERCHANT_PRIVATE_KEY`). If unconfigured, quests silently return 0.
- Private payments counted via `payments.from_chain IS NOT NULL` (MagicBlock-only signal) +
  `is_devnet = false`.
- **Gotcha**: the admin sweep does a live Blink API + Privy lookup per user at concurrency 20
  across all app users — expensive/slow at scale; a Blink API outage silently degrades every
  user's deposit count to a possibly-wrong 0 (only surfaced to admins via
  `depositLookupError`, not to end users).

## Megapot campaign

`rewards/megapot-campaign.service.ts`.

- **Window**: 2026-07-07T15:00Z – 2026-08-31T00:00Z. Requires **5 tickets**
  (`REQUIRED_TICKETS`), advertised prize pool **$1000** (`PRIZE_POOL_USD`) — a lucky-draw style
  reward, not a per-user payout.
- Counts `lottery_tickets.num_tickets` summed where `burner_sol_address IS NOT NULL` (i.e.
  genuinely privately-funded purchases — public purchases and gift-funded tickets don't count),
  status in `sent|bridging|buying|active|won|lost|withdrawn`, within the campaign window.
- Admin endpoint returns only users with tickets purchased, sorted qualified-first then by
  ticket count — effectively the eligible-participant list for manually running the draw.
- A related, adjacent campaign also exists: `getpaid-campaign.service.ts` (`GET
  /rewards/getpaid/me`) — a "$50 x 3" draw campaign, worth knowing it's there.

## MagicBlock quests — push API validation

`apps/backend/src/modules/magicblock-quest/magicblock-quest.service.ts` +
`magicblock-quest.controller.ts` (`GET/POST /rewards/magicblock/...`). Tables:
`magicblock_wallets` (write-once user↔wallet link), `magicblock_quest_pushes` (push attempt
ledger, unique on `(quest_type, source_id)`).

- **Push mechanism**: `pushToMagicBlock()` POSTs to
  `https://quests.magicblock.app/api/validators/push` with `{ payload: { quest: questId, user:
  walletPubkey, timestamp } }`, Bearer-authed via `MAGICBLOCK_QUEST_PUSH_API_KEY`. Quest IDs are
  **hardcoded** (`lottery_ticket` → 43, `private_payment` → 44) — deliberately a constant, not
  an env var, since env drift between local/Railway already caused this to silently no-op in
  production once (2026-07-24).
- **Trigger points**: fire-and-forget calls from `confirmSend` (lottery), `confirmMultiSend`
  (send-payment), and `updateStatus` (claims). Each independently re-verifies the qualifying
  condition against the DB, never trusting the caller — this sits downstream of real money
  movement and must never fail a purchase/payment.
- **Idempotency**: `pushForAction()` inserts a `magicblock_quest_pushes` row up front to reserve
  `(quest_type, source_id)`; a `23505` unique-violation is treated as "already pushed,"
  preventing double-push under concurrency/retries.
- **Retry/self-heal**: `retryFailedPushes()` runs on every `GET /rewards/magicblock/me`,
  retrying any failed push older than a 15s cooldown, scoped to the current quest week.
- **Weekly reset**: quest completion is windowed to "current quest week" = most recent Friday
  10:00 CET/CEST through the next, computed with explicit DST-aware timezone math
  (`Europe/Paris`).
- **Backfill**: connecting a wallet for the first time triggers
  `backfillQuestsForNewWallet()`, re-running the qualifying push for every pre-existing private
  ticket/payment — added after a real 2026-07-24 incident where users bought privately, then
  connected their wallet later, and their quest never got a first push attempt (the
  purchase-time push requires a wallet and returns early with no row if none is connected).

**The private_payment race condition fix (2026-07-30)** — see memory: [MagicBlock quest
validation]:
- **Root cause**: when a claim's burner sweep completes, `is_private` gets set from
  `extra.deliveredPrivately` for *that specific delivery leg*. Bug: if the sender's payment was
  already correctly stamped `is_private = true` (from a private MagicBlock transfer into the
  burner), a **recipient's later non-private claim** of that same burner would overwrite
  `is_private` back to `false` — silently erasing the completed private-payment stamp the quest
  push depends on.
- **Fix**: `maybePushPrivatePaymentQuest`'s qualifying check now accepts `status === 'SUCCESS'
  OR status === 'PRIVATE_TRANSFER_PENDING'`, not just `SUCCESS`. Rationale (from code comments):
  for a burner-mediated private send, the sender's own leg (into the burner) is already
  confirmed on-chain at `PRIVATE_TRANSFER_PENDING` — the claim only stays "pending" because the
  recipient hasn't swept yet. Waiting for the claim's own eventual `SUCCESS` doesn't work: the
  recipient's later non-private claim overwrites `is_private` back to `false` first. So the push
  now fires at the earlier, safe `PRIVATE_TRANSFER_PENDING` checkpoint instead of racing the
  recipient's claim.
- **Open gotcha**: this is a workaround, not a root-cause fix — `claims.service.ts`'s
  `updateStatus` can still flip `is_private` false→true→false depending on claim path, so any
  *other* consumer of `payments.is_private` (besides this quest-push check) could still be
  exposed to the same race. Grep `is_private` usages before trusting that column elsewhere.
