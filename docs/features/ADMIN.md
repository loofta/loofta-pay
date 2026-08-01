# Admin

## Analytics, outreach, campaign

**Analytics**: a working dashboard exists, but it's **frontend-only** — the query logic lives
entirely in a Next.js API route talking straight to Supabase, with no dedicated backend
(NestJS) module.
- UI: `apps/frontend/src/app/app/[adminHash]/tabs/AnalyticsTab.tsx`, rendered inside
  `AdminDashboard.tsx` (access-gated by an `[adminHash]` URL segment on this particular route,
  unlike other admin API routes which use `isAdmin()`/`AdminGuard`).
- API: `apps/frontend/src/app/api/admin/analytics/route.ts` — a single `GET` fanning out ~16
  parallel Supabase queries (payments, app_users, mainnet_waitlist, lottery_tickets,
  user_deposits, withdrawals) computing devnet/mainnet volume, tx counts, unique/repeat senders
  >$5, a signup→link→funded→claimed funnel, lottery/deposit/withdrawal volume, and a
  platform-wide `volume_total_all`. Cached 60s at the edge.
- Also present: `api/dune/stats/route.ts` (Dune-sourced stats), and other admin tabs:
  `LotteryTab`, `PacksTab`, `PaymentsTab`, `CashoutTab`, `SparksTab`, `WaitlistTab`, `BlinkTab`.
- **Backend side**: no `analytics` module exists in `apps/backend/src/modules` at all. The only
  backend "admin" surfaces are per-feature controllers (`admin-claims`, `admin-integrators`,
  `admin-lottery`, `admin-waitlist`), all guarded by `admin.guard.ts` (`ADMIN_PRIVY_USER_IDS`
  env var, falling back to `users.role = 'admin'` in Supabase).
- **Gotcha**: analytics queries use `.limit(100000)` and aggregate raw rows client-side in JS
  rather than SQL aggregation — fine at current scale, a WIP-style shortcut that won't scale
  indefinitely.

**Outreach/campaign** — two separate systems, easy to conflate:
- **Twitter payment bot** (`apps/twitter-bot`, see memory: [Twitter bot feature plan]) — polls
  `@looftapay` mentions every 3 min, parses `@looftapay send $X to @handle`, creates a payment
  via the backend's `integrators` module (Bearer-authed per-integrator key), replies with a
  claim link. Currently **hardcoded devnet-only** (`is_devnet: true`) even though an
  `IS_DEVNET`-derived flag exists unused for that purpose — comment says "flip to `IS_DEVNET`
  when mainnet is ready."
- **Outbound/prospecting "Outreach Dashboard"** — a full DM-prospecting tool, entirely
  frontend, **not** part of the twitter-bot app:
  - UI: `app/app/[adminHash]/outreach/OutreachDashboard.tsx`.
  - API routes: `api/outreach/{prospects,config,draft,discover,discover-defi,
    check-engagement,send-dm,bulk-send}/route.ts`.
  - DB: `outreach_prospects`, `outreach_config`, a bulk-send job table.
  - Prospect types: `creator | freelancer | web3_project | giveaway_project` (see memory:
    [Target audience framing] — never "DAO"). Flow: discover (X search or DefiLlama) → AI-draft
    a qualify+pitch message → approve/reject → send DM (single or polled bulk job) → track
    replies/follows.
  - This is a fairly heavy, AI-in-the-loop marketing tool bolted directly onto the admin app,
    not a separate backend service — worth knowing it's not NestJS code at all.

## Fee earning

**There is no unified "fee consolidation" service.** Confirmed by grepping "consolidat" and
"fee" broadly — the `consolidat*` hits that do exist are about **lottery ticket/companion
consolidation** (batching won Megapot tickets into one bridge, `processConsolidatedBatch` in
`lottery.service.ts`), unrelated to fee aggregation.

Fee tracking is scattered per-feature, each with its own constant/column:
- **Privacy fees on payments**: `magicblock-private-transfer.ts` — `MAGICBLOCK_VOLUME_FEE_BPS =
  10` (MagicBlock's cut) + `MAGICBLOCK_GAS_USDC = 0.2` flat relay fee, plus Loofta's own
  `SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS = 10` / `MULTI_SEND_LOOFTA_PLATFORM_FEE_BPS = 10`
  (toggleable). Recorded per-payment in `payments.fee_paid_usdc` / `payments.fee_on_sender`.
  See [Payments → Privacy fees](PAYMENTS.md#privacy-fees).
- **Cross-chain fees on deposit/withdraw**: `deposit.service.ts` —
  `CROSS_CHAIN_LOOFTA_FEE_BPS = 30`, grossed up into the bridged amount alongside a MagicBlock
  gas estimate.
- **Megapot referral fee**: `megapot.service.ts` reads the live, unclaimed `referralFees(address)`
  balance on the Jackpot contract (~10% protocol/referral cut,
  `DEFAULT_REFERRAL_WIN_SHARE_FACTOR = 0.9` fallback) via `getReferralFeesBalanceUsdc()`.
  Exposed read-only at `GET /admin/lottery/referral-fees`, surfaced in the admin `LotteryTab`.
  **Claiming is manual** — the endpoint deep-links to Basescan's contract UI for
  `claimReferralFees()`; there's no automated claim/sweep flow.
- **Lottery ticket fees**: separate migration-tracked columns (`fee_swept`, `upfront_fee`).

**The need for a fee consolidation service**: fee data lives in at least 4 different places
(payments columns, deposit gross-up math, Megapot on-chain contract reads, lottery_tickets
columns) with no single table/service rolling them into one "total fees earned" number. This is
a real gap if leadership wants a consolidated fee/revenue dashboard — currently that number
would have to be manually assembled from four different sources, one of which (Megapot referral
fees) requires reading a live on-chain balance rather than a DB query.
