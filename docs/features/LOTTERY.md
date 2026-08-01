# Lottery

Core module: `apps/backend/src/modules/lottery` — `lottery.service.ts` (5,484 lines, the
module's core), `pack.service.ts` (Mystery Packs), `megapot.service.ts`, `relay.service.ts`,
`lifi.service.ts`, `rhinestone.service.ts`, plus `lottery-cron.service.ts`.

## Private or public purchase

- **Private (default)**: `POST /lottery/buy` → `initiatePurchase()` (`lottery.service.ts:280`).
  Builds a MagicBlock private transfer of exactly `numTickets * $1` from the user's wallet into
  a freshly generated burner keypair — the only transaction the buyer signs. Loofta no longer
  collects a separate service fee; the bridge cost is absorbed from Loofta's own fee-wallet
  reserve. Confirmed via `POST /lottery/buy-confirm` → `confirmSend()`.
- **Public**: `POST /lottery/buy-public` → `initiatePublicPurchase()` (allows 1–500 tickets vs.
  100 max for private). Despite the controller doc-comment saying it "returns a NEAR Intents
  deposit address," the actual implementation (`buildPublicPurchaseTransferTx`) builds a plain
  sponsor-cosigned USDC transfer into the burner (no MagicBlock privacy) — same burner→Base
  bridging path afterward.
- A `route?: 'solana_private' | 'solana_public'` field exists on `buy`, `buy-gift`, and
  `withdraw-batch` DTOs, defaulting to `'solana_private'` everywhere.
- Downstream of the sender→burner leg, both paths converge: `processSentTickets()` →
  `tryStartBridge()` (burner SOL → Base companion, see below) → `tryBuyTickets()` (real Megapot
  on-chain buy from the Base "companion" smart account via Rhinestone).
- **Draw cutoff guard**: `assertNotInDrawCutoff()` blocks new purchases within 5 minutes of the
  round's draw (7 PM CET daily).
- **MagicBlock quest tie-in**: a private purchase can qualify the `lottery_ticket` quest — see
  [Rewards → MagicBlock quests](REWARDS.md#magicblock-quests--push-api-validation).

## Cross-chain swap — Relay or Li.Fi?

**Both are implemented; selection is via the `BRIDGE_PROVIDER` env var. The deployed/local
configuration uses Relay, but the code's own built-in fallback if the var is unset is Li.Fi,
not Relay** — worth knowing precisely which is which:

```
this.config.get<string>('BRIDGE_PROVIDER') === 'relay' ? 'relay' : 'lifi'
```

`apps/backend/.env.local` sets `BRIDGE_PROVIDER=relay` and a real `RELAY_API_KEY`, so the
actual running configuration uses **Relay**. `docs/MEGAPOT_BRIDGE.md` documents this as "Relay
(default) with Li.Fi fallback" and instructs setting `BRIDGE_PROVIDER=relay` on Railway too —
that "(default)" language describes the *intended deployed env*, not the code's built-in
fallback, which is Li.Fi.

Both legs (purchase Sol→Base in `tryStartBridge()`, withdrawal Base→Sol in
`bridgeCompanionToBurner()`/`processLifiWithdrawal()`) branch on this flag. **In-flight bridges
never get orphaned by toggling the flag** — status polling branches on the *stored* tool
per-row (`lottery_tickets.lifi_buy_tool` / `lottery_withdrawals.lifi_step_tool`, values `'relay'`
or a Li.Fi tool name), not the live config value.

Relay quotes are ~3s vs. Li.Fi's Mayan/Allbridge Solana routes (slower); fees are a mostly-flat
~$0.02 for Relay vs. ~0.4–0.5% (Across, small amounts) to ~1.3% (NEAR Intents, larger amounts)
for Li.Fi — both absorbed by Loofta's fee wallet, not charged to the user.

**Known incident**: `relay.service.ts`'s `getWithdrawalFeeEstimate` used to quote against the
System Program ID as a dummy recipient; Relay tightened validation on 2026-07-24 and started
rejecting it, breaking every withdrawal fee estimate in prod — fixed by switching to the Solana
incinerator address.

## CRON

`LotteryCronService` — production-only (`isProd` gate; a local backend racing production over
shared Supabase rows/burners is explicitly avoided by design):

| Cadence | Method | Purpose |
|---|---|---|
| 5s | `processSentTickets` | check sent tickets for USDC landing, start bridge |
| 5s | `processBridgingTickets` | poll bridge status, buy Megapot ticket once landed |
| 30s | `processPendingWithdrawals` | advance private withdrawal pipeline (bridge → MagicBlock) |
| 15m | `checkDailyResults` | resolve `active` tickets whose draw has passed |
| 5m | `backfillTicketNumbers` | backfill NFT ball numbers for active tickets missing them |
| 5m | `sweepFinishedBurners` | sweep leftover SOL/USDC/rent from finished burners |
| 2m | `refundOutstandingFees` | refund upfront fee for failed/abandoned purchases |
| 2m | `refundStalledBridges` | auto-refund tickets stalled >20 min with no solver activity |
| 2m | `recoverStuckBatches` | recover consolidated withdrawal batches whose lead bridge never submitted (crash recovery) |
| 2m | `autoRetryFailedTickets` | auto-retry failed tickets, capped at 3 retries, within a 48h window |
| 30m | `checkFeeWalletBalance` | email-alert operator if fee wallet SOL/USDC runs low |
| 5m | `cancelAbandonedPendingSends` | clean up abandoned `pending_send` tickets (10min+, never signed) |
| 2m | `retryFailedPackPurchases` | retry Mystery Pack treasury-funded ticket purchase failures |

**Incident note**: `retryFailedPackPurchases` was briefly disabled 2026-07-29 — the old
`topUpFromFeeWallet` used `confirmTransaction`, which could throw a false "expired" error on a
transfer that actually landed, and the burner's key was only persisted *after* that call
returned — causing repeated re-spends of real treasury USDC into lost burners on every retry.
Fixed by persisting the burner key before spending and polling signature status instead of
racing block height.

A separate, generic (non-lottery-owned) cron surface exists at
`apps/backend/src/modules/cron/*` — see [Payments → CRON](PAYMENTS.md#cron).

## Redeem win

**Win resolution**: `checkDailyResults()` → `checkDailyResultsInner()` selects `active` tickets,
filters on `draw_time < now` **OR** `round_id !== current active round id`. That JS-filter
approach (rather than a DB-only `draw_time` filter) was itself a 2026-07-30 fix — the old
DB-only filter permanently missed tickets whose `draw_time` never got populated due to a
transient Megapot API failure at purchase time (a whole round's worth of tickets got stuck
`active` forever before this — see memory: [Lottery tickets orphaned when round_id null]).
Resolves via `resolveTicketWin()`/`resolveTicketWinFromChain()`, then `notifyTicketWon()` sends
the immediate "you won" email.

**Claiming winnings**:
- `POST /lottery/tickets/:id/play-again` — reinvests a win directly into new tickets, no
  bridge, no fees.
- `POST /lottery/withdraw` → `initiateWithdrawal()` — `route: 'base'` does a direct on-chain
  USDC transfer; `route: 'solana_private'` delegates to `initiateWithdrawalBatch()`, converging
  N companion wallets → one shared burner → a single MagicBlock private (or public) transfer to
  the user.
- `WITHDRAW_MIN_USDC = 1.3` — a win below this is a "free ticket": Play Again only, no cash
  withdrawal (bridge+relay fees would eat most of a smaller amount), surfaced as `isFreeTicket`.

**"Unclaim win email"** (commit `8808271`, 2026-07-30) added
`EmailService.sendUnclaimedWinningsReminderEmail()` — a reminder distinct from the immediate
win email, meant to nudge users who won but never withdrew.

**Gotcha — currently dead code**: this method has **zero callers** anywhere in the repo. No
cron, controller, or service wires it up. It was added in the same commit as the quest-race fix
below, but the trigger/scheduling side was never finished. Treat "unclaimed winnings reminders"
as a stub needing a caller (e.g. a new cron scanning `lottery_tickets` for `status='won'` with
no matching withdrawal row past some age), not a shipped feature.

## Megapot API

`megapot.service.ts` (1,026 lines) is the single integration point:
- **On-chain (Base)**: `MEGAPOT_USDC`, `MEGAPOT_RANDOM_BUYER`, `MEGAPOT_JACKPOT`
  (`buyTickets`/`claimWinnings`/`referralFees`/`getDrawingState`/`currentDrawingId`),
  `MEGAPOT_TICKET_NFT` (ball numbers via `tokenURI`). Ticket price hardcoded at $1.
- **Off-chain REST API** (`api.megapot.io/v1`): `getActiveRound`, `getRound`,
  `getWalletTickets`, `getWalletWins(ForRound)`, `getWalletStats`,
  `getLatestSettledPrizeTiers`/`getPrizeTiersForRound`, `getWinningNumbersForRound`.
- **Purchase/claim execution**: `buyTickets()` and `claimWinnings()` execute the actual
  Base-chain contract calls through Rhinestone-sponsored userOps
  (`rhinestone.service.ts`). `getTicketNumbersFromNft`/`FromApi` and
  `checkTicketResultsFromNft` reconcile outcomes both from NFT metadata (on-chain, authoritative
  fallback) and the REST API.
- **Referral**: `getReferralFeesBalanceUsdc()` reads the live unclaimed referral fee balance on
  the Jackpot contract; see [Admin → Fee earning](ADMIN.md#fee-earning).

## Mystery Packs — odds & admin

`pack.service.ts` (749 lines) + `pack.controller.ts` (public) + `admin-lottery.controller.ts`
(`/admin/lottery/packs/*`).

- **Price**: `PACK_PRICE_USDC = 2`, a plain public USDC transfer to a treasury address (reuses
  `SOLANA_FEE_PAYER_PRIVATE_KEY` as the treasury signer — same custody model, no new secret).
  Verified on-chain by `verifyPackPaymentOnChain()` (checks both amount **and** sender identity,
  to prevent replaying an unrelated ≥$2 tx as a "pack payment").
- **Tiers/odds** (`pack_tiers` table):

  | tier_key | tickets_awarded | true probability | rarity | enabled |
  |---|---|---|---|---|
  | 1 | 1 | 43% | common | ✅ |
  | 2 | 2 | 50% | common | ✅ |
  | 5 | 5 | 5.56% | uncommon | ✅ |
  | 10 | 10 | 1.18% | uncommon | ✅ |
  | 50 | 50 | 0.25% | rare | ❌ |
  | 100 | 100 | 0.0625% | epic | ❌ |

  Weights are **never** exposed to the client — the public config only returns
  `tierKey`/`ticketsAwarded`/`rarity`/`displayOrder`. `rollTier()` uses `crypto.randomInt` (not
  `Math.random()`) over the full table including disabled tiers, so disabling 50/100 doesn't
  skew the relative odds of the enabled ones; a disabled-tier roll falls back to the
  next-lower *enabled* tier (currently pays out as 10 tickets).
- **Admin controls** (`/admin/lottery/packs/*`): enable/disable a tier, view full odds, treasury
  balance vs. `MIN_TREASURY_BALANCE_USDC = 10` (packs go "unavailable" if the treasury can't
  cover the worst-case currently-enabled payout — 10 tickets × $1), net revenue (gross pack
  payments − ticket cost of tickets awarded), daily-open-limit-per-user setting, a paginated
  opening audit log, and a manual refund action for a `'failed'` opening (guarded against
  double-pay if `lottery_ticket_id` is already set).
- **Fulfillment**: `openPack()` records the win first (`pack_openings`, `status='opened'`), then
  `fulfillPackOpening()` → `purchaseTicketsForUser()` (treasury-funded) → `status='fulfilled'`.
  On failure, the row stays `'failed'` for the `retryFailedPackPurchases` cron — the win is
  never lost even if the immediate purchase fails.
- **Recovery/anti-double-pay**: `findRecoverablePayment()` scans the treasury's recent incoming
  transfers for a confirmed-but-unconsumed payment (client dropped mid-flow) within a 1-hour
  window; a partial unique index on `pack_openings.payment_tx_hash` (non-null) is the DB-level
  backstop against two concurrent opens reusing the same hash.
- **Demo mode**: `openPackDemo()` — real tier roll, no payment, no real purchase, hard-blocked
  in production except one hardcoded user id.

**Note for future readers**: the migration's own comment on `pack_openings.lottery_ticket_id`
says automatic ticket purchase is "still design pending" — that has since shipped
(`fulfillPackOpening` does purchase automatically); the migration comment is stale relative to
current service code.

## Gift

Lottery-ticket-only (no gifting of Mystery Packs — grepping `pack.service.ts`/
`pack.controller.ts` for "gift" returns nothing).

- **Two funding modes**, both on `lottery_gifts`:
  - `sender_paid` — `POST /lottery/buy-gift` → `initiateGiftedPurchase()`. Sender signs a
    MagicBlock private (or public) transfer into a burner tied to the gift record itself, not a
    ticket yet. Confirmed via `confirmGiftSend()`, which flips `pending_payment → unclaimed`.
    **The actual Megapot purchase doesn't happen until the recipient claims.**
  - `admin_treasury` — `POST /admin/lottery/gift` → `createGift()` (`AdminGuard`-protected),
    funded straight from Loofta's fee wallet, no sender payment step.
- **Claiming**: `GET /lottery/gift/:token` (public, optional auth) for the claim landing page;
  `POST /lottery/gift/:token/claim` → `claimGift()` — verifies recipient identity (matches by
  email, X handle, or Loofta username depending on `recipient_type`), atomically flips
  `unclaimed → claimed` (same conditional-update race-guard pattern used for claim burner
  sweeps), then `purchaseGiftTickets()` does the real buy: a fresh Base companion wallet for the
  claimant, funded either from the gift's own pre-funded burner (`sender_paid`) or topped up
  fresh from the fee wallet (`admin_treasury`), inserting the `lottery_tickets` row with
  `is_gift: true`.
- **Recipient targeting**: email or handle (X/Loofta username), normalized via
  `normalizeGiftIdentifier()`.
- **Sender self-service**: `GET /lottery/my-gifts` (sent gifts + status + claim link),
  `POST /lottery/my-gifts/:giftId/recipient` → lets a sender fix a typo'd recipient while still
  `unclaimed`, without cancelling.
- **Rate limit**: max 3 concurrent `pending_payment` gifts per user within 15 minutes.
- **Retry safety**: `claimGift()` is idempotent for a claim that reached `status='claimed'` but
  whose downstream purchase failed — the same claimant can retry `purchaseGiftTickets()` without
  re-verifying identity or re-racing the atomic claim.
- **Dashboard accounting**: a claimed-gift ticket is excluded from the recipient's "spent" stat
  (they never paid) but still counts toward "won" if it wins.

---

### Cross-cutting gotchas
1. `BRIDGE_PROVIDER`'s code-level fallback is Li.Fi, not Relay — don't assume "no env var =
   Relay" without checking `.env.local`/Railway config.
2. `sendUnclaimedWinningsReminderEmail` is built but unwired — needs a trigger to actually fire.
3. `round_id` can still be null on a ticket past purchase; mitigated by the 5-min backfill cron
   and the dual-filter fix, but a ticket with *both* `round_id` and `draw_time` null that never
   backfills would still be invisible to result-resolution.
4. Lottery crons are production-only — a local backend against prod Supabase silently does
   nothing for lottery money-movement, by design.
5. `pack_openings.lottery_ticket_id`'s migration comment is stale relative to shipped code.
6. Money-moving retry logic (`topUpFromFeeWallet`, pack purchase retries) has a documented
   history of a real double-spend-adjacent incident (2026-07-29) — treat future refactors of
   that ordering as security-sensitive, per the repo's `solana-sponsor-safety` conventions.
