# ZK-Compressed Airdrop Feature — Proposal (not built)

> **Status: proposed, not started.** No code from this doc has been written to the repo. This
> is a design doc for a future feature branch, written 2026-08-10. Nothing here should be
> treated as reflecting current app behavior — if you're looking for how something works today,
> see [docs/features/](../features/) instead, which is grounded in shipped code.

## Context

The team wants to airdrop an arbitrary SPL token to a list of recipients identified by social handle or email (not necessarily existing wallets), with each recipient getting a claim link, and a privacy option for claiming — inspired by Helius's Airship repo and Light Protocol's ZK compression.

Airship itself isn't directly reusable: it's a direct-to-known-wallet sender (CSV/on-chain snapshot), with no claim-link step, no handle/email resolution, and no privacy option — it doesn't solve the actual problem. What's reusable is the underlying Light Protocol compressed-token tech, and conceptually the "compress cheaply, decompress only for people who actually claim" pattern from Light's reference airdrop implementations.

Loofta already has ~90% of an airdrop feature: `giveaways` already does "distribute to N winners via claim link" (including on-chain MagicBlock VRF for random winner selection), `payments` already resolves recipients by pending email/username/social-handle sentinels, `SolanaSponsorService` already sponsors gasless claims, and `is_private` is already a per-claim toggle backed by the MagicBlock private-transfer path. The real gap is (a) arbitrary-SPL support — the whole stack is hardcoded to USDC — and (b) using ZK compression so the team doesn't pay real Solana rent (~0.002 SOL) for every recipient upfront, only for the ones who actually claim.

This design went through two rounds of research (codebase archaeology + a design-stress-test pass) and a round of scoping questions before landing here — see "Direct answers" below for the reasoning behind several non-obvious choices.

## Direct answers to the open questions

- **"Will burners cost us rent for every recipient upfront?"** No. A burner **Keypair** (just a public/private keypair, free to generate) is minted for every recipient at compression time, but its real on-chain token account — the thing that actually costs ~0.002 SOL rent — is only created when that specific recipient claims. Compressing an allocation into a burner's *compressed* balance costs ~5,000–10,300 lamports (~0.00001 SOL), not the ~2,000,000 lamports (~0.002 SOL) a real SPL account costs. So the team pays the tiny compressed rate for every recipient, and the real rent only for the recipients who actually show up and claim.
- **Concrete cost example**: 1,000 recipients, 30% claim rate — compress all 1,000 (~1,000 × 8,000 lamports ≈ 0.008 SOL) + 300 real claims (~300 × 2,000,000 lamports ≈ 0.6 SOL) ≈ **~0.61 SOL total**, vs. ~2 SOL if 1,000 real ATAs were pre-created upfront the way `giveaway-payout.service.ts` does it today (paid regardless of whether anyone ever claims). Savings scale with the unclaimed fraction — the more typical of an airdrop (vs. a guaranteed-claim payment) the list is, the bigger the win.
- **Deadline + return unclaimed funds** — included as a first-class feature: batch-level `claim_deadline_at` + a reclaim job.
- **Pick X winners from an imported list via VRF** — included as a second selection mode, reusing giveaways' existing MagicBlock VRF draw exactly as-is.
- **Claim page messaging** — reuses the same `description`-field pattern giveaways already use ("Congrats on winning..."), not a new UI branch. See Phase 6.
- **Token picker with icons, like Phantom** — included in Phase 6 (Jupiter's public token list, the same source most wallets use for icon/symbol/decimals resolution).
- **Prevent bad users** — addressed via (a) team-only batch creation for v1, (b) mint safety pre-checks before funding, (c) reusing the existing `ata-sponsorship-guard.ts` per-user/per-wallet/burst protections unchanged at claim time. See "Abuse prevention" below.
- **New risk from reusing anything?** Yes, one real one: this would be the first time Loofta integrates a new third-party signing/transaction-building SDK (`@lightprotocol/*`) and a new RPC provider (Helius) into a real-money path. Everything *else* reused (fee-payer sponsorship, ATA guard, burner-per-recipient pattern) is already hardened. The new compression code would not be, and should get a security pass (the `solana-sponsor-safety` review convention already used for other money-moving features) before real funds go through it — called out explicitly in Phase 7.

## Scope for v1

- **Any SPL token**, arbitrary mint per batch.
- **Recipients by email or social handle** (existing `payments` pending-sentinel resolution, unchanged).
- **Two selection modes**, both in v1:
  - **All-recipients**: team uploads {identifier, amount} rows; everyone gets an allocation.
  - **Random-subset-via-VRF**: team uploads {identifier} rows (no amount) plus a `winner_count` and a flat `prize_amount_base_units`; the batch reuses giveaways' existing on-chain MagicBlock VRF draw to randomly select `winner_count` recipients from the list. Only winners get compressed allocations + claim links; non-winners are marked `not_selected`, same enum value `giveaway_entries.status` already uses.
- **Claim deadline + reclaim**: every batch has an optional `claim_deadline_at`. After it passes, unclaimed recipients' compressed allocations are swept back to the batch creator (reusing the same pattern `GiveawayBurnerSweepService.refundRemainingToCreator` already uses for giveaway leftovers).
- **Public claims only.** Private claiming is deferred to v2 — MagicBlock's private-transfer fee math (`magicblock-private-transfer.ts`) is USDC-denominated (`MAGICBLOCK_GAS_USDC`, 10 BPS of a USD amount) and generalizing it correctly to arbitrary-decimal SPL is real, separate work. The private-claim toggle would be hidden on the claim page specifically for airdrop-sourced payments in v1.
- **Team-only batch creation for v1**, not open to all users. Arbitrary SPL is new trust surface (unvetted mints, Token-2022 tricks, real money moving through a brand-new code path) — restricting creation to internal admin accounts removes most of the abuse surface while the mint-safety checks and claim-burst behavior get proven out on team-run batches first. Opening creation to any user (mirroring giveaways' public-create + admin-approval flow) is a natural v2 once this is battle-tested.

## Architecture

### Compress directly to per-recipient ownership at funding time (not a pooled escrow)

Light Protocol's `compress()` supports a batched call with parallel `amounts[]`/`recipients[]` arrays — compressing straight into N distinct owner pubkeys in one instruction. So instead of pooling the whole batch under one escrow-owned compressed balance and doing a two-hop decompress-then-transfer at claim time, each recipient would get their own burner Keypair **minted and set on the `payments` row at compression time**, and their allocation compressed directly to that burner's own pubkey as owner.

This matters for two concrete reasons:
1. Every existing insert path in `claims.service.ts` mints a burner at row-creation time, by explicit documented convention ("every payment routes through a burner... the sender never pays a recipient's real wallet directly"). Deferring burner creation to claim time would be the first deviation from that invariant, and it would silently break `claimAsRecipient()` — that function fetches the `claim` row once at the top and reads `claim_burner_address` off that same in-memory object later (L1466/1474 in `claims.service.ts`) to decide whether to schedule a background retry sweep; a burner minted later than that fetch is invisible to those checks.
2. It removes an on-chain hop: claim time becomes "decompress this payment's own compressed balance into its own real ATA" (one hop), not "decompress escrow's pooled balance into escrow's ATA, then real-SPL-transfer into a freshly-minted burner ATA" (two hops).

Cost math (from Light's docs): compressing N allocations costs ~N × 5,000–10,300 lamports total, vs. N × ~2,000,000 lamports if N real ATAs were pre-created (today's giveaway-payout pattern). Decompression at claim time costs one additional ~2,000,000 lamports (real rent), paid once, only for recipients who actually claim — this is where the savings come from, and it survives unchanged by using per-recipient owners instead of a pooled escrow.

### USDC is hardcoded deep in the claim sweep — patch additively, don't route around it

`resolveClaimNetwork()` (`claims.service.ts:1188`) ignores `payment.to_token` and always resolves to the USDC mint; `sweepClaimBurnerToWallet()` has ~15 call sites doing amount math with a literal `1_000_000` (hardcoded 6-decimal USDC). Both would need small, additive early-return branches for `funding_source === 'airdrop_compressed'` rows — reading `payment.to_token`/`payment.token_decimals` off the row instead of assuming USDC — rather than a rewrite. This is unavoidable (the claim page UI is genuinely token-agnostic already, but the fund-movement code underneath it is not), so the plan budgets for it explicitly instead of discovering it mid-build.

### Winner selection: reuse giveaways' VRF draw as-is

Giveaways already have a full on-chain-VRF winner-selection pipeline (`vrf_request_slot`, `vrf_randomness`, `vrf_requested_at`, `vrf_fulfilled_at`, `entry_snapshot_hash` columns; `select-winners`/`force-run-draw` endpoints in `giveaways.controller.ts`). For airdrops, the "entries" would simply be the uploaded recipient rows themselves — there's no self-entry/task-verification step to build, since the team supplies the list directly. The selection *algorithm* (VRF-seeded random index draw over a snapshotted entry list) is reused unchanged; only the "what counts as an entry" source differs (uploaded `airdrop_recipients` rows instead of self-submitted `giveaway_entries`).

### Claim-deadline reclaim

`airdrop_batches.claim_deadline_at` (nullable — omitting it means no deadline, funds sit claimable indefinitely, matching today's giveaway/payment behavior). A cron job (`airdrop-cron.service.ts`, same file that drives the funding→compression state machine) would check for batches past their deadline with unclaimed recipients, mark those `airdrop_recipients.status = 'expired'`, and sweep their still-compressed allocations back to the batch creator's wallet — reusing `GiveawayBurnerSweepService.refundRemainingToCreator`'s pattern (decompress + real transfer + close), adapted to source from each expired recipient's compressed balance instead of one shared burner's real ATA.

### Abuse prevention

- **Team-only creation** (see Scope) removes the largest attack surface: no untrusted user can spin up a batch against an arbitrary mint in v1.
- **Mint safety pre-checks** before a batch can move to `PENDING_FUNDING`: reject Token-2022 extensions Light's `compress()`/`decompress()` doesn't support, verify decimals/metadata are readable, sanity-check total supply against the batch's claimed `total_amount_base_units`.
- **Claim-time protections are inherited, not rebuilt**: every real ATA created at decompress time would still go through the existing `guardAtaSponsorship`/`assertPerUserAtaCreationCapNotExceeded` checks (per-wallet and per-user sponsorship caps, fleet-wide burst breaker) — the same anti-drain code every other claim path already uses, unmodified.
- **One claim per recipient row**, enforced the same way every other `payments` row already is (status transitions out of claimable state on success) — no new double-claim surface introduced.

### New tables (proposed)

`airdrop_batches` (modeled on `giveaways` — same RLS deny-all + `_safe` view convention):
- `id, created_at, updated_at, created_by, title, description`
- `mint, token_decimals, is_devnet`
- `escrow_address, escrow_encrypted_secret` — one funding-collection Keypair per batch (team deposits total supply here before compression; not used as a pooled claim source)
- `total_amount_base_units, funding_confirmed_base_units`
- `selection_mode` (`all` / `random_subset`), `winner_count` (nullable, required if `random_subset`), `prize_amount_base_units` (nullable, flat per-winner amount if `random_subset`)
- `vrf_request_slot, vrf_randomness, vrf_requested_at, vrf_fulfilled_at, entry_snapshot_hash` — reused verbatim from the `giveaways` VRF columns, only populated when `selection_mode = random_subset`
- `claim_deadline_at` (nullable)
- `recipient_count, claimed_count`
- `status`: `DRAFT → PENDING_FUNDING → FUNDED → COMPRESSING → DISTRIBUTING → COMPLETED / CANCELLED / UNDERFUNDED_EXPIRED` (no `PENDING_APPROVAL`/`REJECTED` states needed for v1 since creation is team-only — those can be added back if creation opens up in v2)
- `admin_reviewed_by, admin_reviewed_at, cancel_reason`

`airdrop_recipients` (modeled on `giveaway_entries`):
- `id, airdrop_batch_id (FK), created_at, updated_at`
- `recipient_type, recipient_identifier` — reuse the exact enum `MultiSendRecipientDto` already uses (email/twitter/username/discord/github/telegram)
- `amount_base_units` (set directly in `all` mode; copied from `batch.prize_amount_base_units` for drawn winners in `random_subset` mode)
- `burner_address, burner_encrypted_secret` — minted at compression time, not claim time
- `compressed_at, compress_tx_hash` — per-recipient, since batched compress fan-out (like `GiveawayPayoutService.processGiveaway`'s per-winner loop) must be resumable
- `status`: `pending / winner / not_selected / compressed / claimed / expired / failed`
- `claim_payment_id` (FK to `payments.id`)

`payments` would get three new nullable columns: `airdrop_batch_id` (FK), `funding_source` (default `'direct'`, or `'airdrop_compressed'`), `token_decimals`.

## Build order (for the future branch)

**Phase 0 — pre-flight**
- Production deploys via `railway.json` → `dockerfilePath: Dockerfile.railway`, which pins `node:20-alpine` (root `Dockerfile.railway`), vs. `apps/backend/Dockerfile` which already runs `node:22-alpine`. `@lightprotocol/*` requires Node ≥20.18 — confirmed via `node:20-alpine`'s floating patch tag this is _probably_ fine today, but worth aligning both Dockerfiles to `node:22-alpine` explicitly when this branch starts, to remove the ambiguity rather than rely on an unpinned floating tag.
- Add `@lightprotocol/stateless.js@^0.23.0` + `@lightprotocol/compressed-token@^0.23.0` to `apps/backend/package.json` (there's already an unrelated `@lightprotocol/hasher.rs` dependency in this repo).
- Add `HELIUS_COMPRESSION_RPC_URL` (+ `_DEVNET`) env vars — used only inside the new airdrop module's `createRpc()` calls. Everything else keeps using the existing Alchemy connection via `SolanaSponsorService.getConnectionForCluster()`, per the existing Alchemy-only architecture decision. Deliberately a distinct var from the existing (dormant) `HELIUS_API_KEY` used by gacha's local-dev RPC fallback, to keep this new dependency clearly scoped.
- Decide the launch-day mitigation for `apps/backend/src/common/ata-sponsorship-guard.ts`'s fleet-wide burst breaker (`BURST_THRESHOLD = 40` sponsorships / 10 min, trips platform-wide, not scoped per-feature) — a hyped airdrop claim window is exactly the traffic shape that trips it, and if it trips it blocks every other in-flight Loofta payment claim too. This is an ops runbook item (raise the threshold ahead of a known launch, monitor `getAtaSponsorshipBreakerStatus()`), not code, but must exist before go-live.

**Phase 1 — schema**
- New migration modeled on `apps/backend/supabase/migrations/20260802150000_create_giveaways_tables.sql` (same RLS/`_safe`-view/trigger conventions): `airdrop_batches`, `airdrop_recipients`, `airdrop_events` (mirrors `giveaway_events`).
- Companion migration adding `airdrop_batch_id` / `funding_source` / `token_decimals` to `payments`.

**Phase 2 — module skeleton**
`apps/backend/src/modules/airdrops/`, mirroring `apps/backend/src/modules/giveaways/`:
- `airdrops.module.ts` — imports `ClaimsModule`, `SendPaymentModule` (for `SendPaymentEncryptionService`), `EmailModule`, `IntentsModule`, `UsersModule`, and the giveaways VRF-drawing service (reused, not duplicated). Watch the controller-registration-order convention already documented in `giveaways.module.ts` (specific-prefix controllers before `:id`-based ones).
- `airdrop-burner.service.ts` — thin local `createBurner()`/`decryptBurner()` wrapper around `SendPaymentEncryptionService`, matching the existing per-module convention (no shared `BurnerService` class exists on purpose — `GiveawayBurnerSweepService` and `ClaimsService.createClaimBurner()` each keep their own).
- `airdrops.service.ts` — CRUD + status machine, mirrors `giveaways.service.ts`.
- `airdrop-selection.service.ts` — wraps the reused VRF draw for `random_subset` batches; a no-op passthrough (mark every recipient `winner`) for `all` batches.
- `airdrop-claim-setup.service.ts` — recipient resolution (reuse `UsersService.findByEmail`/`findByUsername`/`findBySocialHandle`, the same lookups `claims.service.ts` already uses) + `payments` row insert per winning recipient, with `PENDING_*` sentinel handling for unregistered recipients, `airdrop_batch_id`/`funding_source`/`token_decimals` set, burner already minted (not deferred).

**Phase 3 — funding**
- `airdrop-funding.service.ts`, using `apps/backend/src/modules/giveaways/giveaway-funding.service.ts` as a template (NEAR-Intents deposit quote for the escrow; per-module convention, not a shared dependency).
- Internal admin controller (team-only auth, no public-create endpoint in v1) with the mint safety pre-checks before allowing `PENDING_FUNDING`: reject unsupported Token-2022 extensions, verify decimals/metadata are readable, sanity-check declared total against on-chain supply.

**Phase 4 — compression (highest-risk new code)**
- `airdrop-compression.service.ts`:
  - `ensureTokenPool(mint)` — idempotent check-then-`createTokenPool()` (permissionless per Light's docs, no mint-authority needed — good, since airdrop mints won't be Loofta-controlled). Note: each mint supports max 4 interface PDAs, write-locked during every compress/decompress — a throughput ceiling worth knowing about if one popular mint gets reused across many concurrent batches (Light's `addTokenPools()` is the escape hatch, not needed for v1).
  - `compressBatch(batch)` — runs the batch through `airdrop-selection.service.ts` first (VRF draw for `random_subset`, or mark-all-winner for `all`), then for each winning recipient: mint a burner via `airdrop-burner.service.ts`, insert its `payments` row via `airdrop-claim-setup.service.ts`, then batch recipients into `compress()` calls with parallel `amounts[]`/`recipients[]` arrays sized to fit Solana tx limits (verify empirically — expect low tens of recipients per tx), checkpointed per-recipient via `compressed_at`/`compress_tx_hash` so a restart resumes cleanly. Same resumable-loop shape as `GiveawayPayoutService.processGiveaway()`.
  - `airdrop-cron.service.ts` (mirrors `giveaway-cron.service.ts`) driving batches `PENDING_FUNDING → FUNDED → COMPRESSING → DISTRIBUTING`, resuming any partially-compressed batch on restart, and separately sweeping any batch past `claim_deadline_at` (marks unclaimed recipients `expired`, reclaims their compressed balance to the creator).
  - Claim-link emails sent per recipient once their row is compressed (reuse the existing claim-link email call already used by `giveaway-payout.service.ts`).

**Phase 5 — claim-time integration (the only touch inside `claims.service.ts`)**
- New file `apps/backend/src/modules/claims/airdrop-claim-sweep.service.ts` — separate service, not code inside `claims.service.ts`. `decompressToBurnerAta(payment)`: decrypts this payment's own burner, `decompress()`s its compressed balance into its own real ATA (creating it, gated by the existing `guardAtaSponsorship`/`assertPerUserAtaCreationCapNotExceeded` anti-drain checks — same as every other real-ATA creation in this codebase).
- Exactly two additive edits inside `claims.service.ts` (changelog entry required per project convention — this file is fragile/real-money):
  1. In `claimAsRecipient()`, right after `checkIsRecipient` succeeds (~L1324) and before wallet resolution: call `airdropClaimSweep.decompressToBurnerAta(claim)` when `claim.funding_source === 'airdrop_compressed'`, mutating the already-fetched `claim` object in place afterward (not reassigning) so the later `claim_burner_address` checks at L1466/1474 see fresh state.
  2. In `resolveClaimNetwork()` (L1188-1197): one early-return branch for `funding_source === 'airdrop_compressed'` rows reading `payment.to_token`/`payment.token_decimals`, ahead of the existing hardcoded-USDC logic. Same additive pattern for the `1_000_000`-literal amount math inside `sweepClaimBurnerToWallet` — thread `token_decimals` through as `10n ** BigInt(decimals)` instead of the literal, at the specific call sites only.
- Private-claim path (`sweepClaimBurnerPrivately`, MagicBlock) would be left untouched — not reached for airdrop payments in v1 since the private toggle is hidden for these rows on the claim page.

**Phase 6 — admin/creator UI + claim messaging**
- Claim page (`apps/frontend/src/app/app/c/[id]/page.tsx`, `ClaimPayView.tsx`) needs no giveaway-style special-casing beyond hiding the private-claim toggle when `funding_source === 'airdrop_compressed'`. Airdrop-specific messaging ("You received an airdrop from {batch.title}") would be set on the `payments.description` field at claim-link-creation time, exactly the same mechanism `giveaway-payout.service.ts` already uses for "Congrats on winning..." — the claim page already renders `description` verbatim, so no new frontend branch is needed for the messaging itself.
- Internal creator/admin tool modeled on `GiveawayWizard.tsx` (creation form) + `GiveawaysTab.tsx` (monitoring dashboard): batch title, selection mode toggle (all vs. random-subset), CSV upload ({identifier, amount} for `all` mode, {identifier} + winner_count + prize amount for `random_subset`), claim deadline picker, funding status, per-recipient claim progress.
- **Token picker**: a searchable SPL mint picker in the funding step, backed by Jupiter's public strict/verified token list API (the same source most Solana wallets, including Phantom, use for symbol/icon/decimals resolution) — search by symbol/name, fall back to raw on-chain mint metadata lookup for tokens not in the list (with a clear "unverified token" warning state, tying into the mint safety pre-check from Phase 3).

**Phase 7 — testing & security review**
- Unit tests for `airdrop-compression.service.ts`'s resumable batching (partial-failure mid-batch must not double-compress) and for the claim-deadline reclaim job.
- Integration test against `light test-validator` (bundles a local Photon indexer) for the full compress → claim → decompress round trip, including the multi-recipient batched `compress()` call and the VRF-selection path.
- Extend the existing `claims.service.spec.ts` with cases for the two additive edit points, specifically guarding against regressing existing USDC claim behavior.
- A claim-burst load test against `ata-sponsorship-guard.ts`'s breaker before the first real airdrop launch.
- Since this would be the first real-money path built on a new SDK (`@lightprotocol/*`) and a new RPC dependency (Helius), run it through the same security-review convention used for other money-moving features (`solana-sponsor-safety`) before any batch with real funds goes live — specifically checking the new compression/decompression signing code, not the reused sponsorship/guard code around it.

## Critical files (for whoever picks this up)

- `apps/backend/src/modules/claims/claims.service.ts` — edit points: `claimAsRecipient()` L1298-1493, `resolveClaimNetwork()` L1188-1197, `sweepClaimBurnerToWallet()` L2122-2325 (decimal-math patch sites only)
- `apps/backend/src/modules/giveaways/giveaway-payout.service.ts` — resumable per-recipient fan-out loop pattern to copy for compression batching
- `apps/backend/src/modules/giveaways/giveaway-burner-sweep.service.ts` — per-module burner service pattern to copy, and the refund-remaining-to-creator pattern to adapt for deadline reclaim
- `apps/backend/src/modules/giveaways/giveaway-funding.service.ts` — funding-quote pattern to copy
- `apps/backend/src/modules/giveaways/giveaways.service.ts` (VRF draw/fulfill logic) — reused as-is for `random_subset` selection
- `apps/backend/src/modules/send-payment/encryption.service.ts` — `SendPaymentEncryptionService`, injected directly (no shared BurnerService)
- `apps/backend/src/common/ata-sponsorship-guard.ts` — burst-breaker risk for launch-day claim spikes
- `apps/backend/supabase/migrations/20260802150000_create_giveaways_tables.sql` — schema/RLS/safe-view template
- `apps/frontend/src/app/app/c/[id]/page.tsx`, `ClaimPayView.tsx` — needs one small conditional (hide private toggle), otherwise reused as-is
- `apps/frontend/src/app/app/rewards/giveaways/GiveawayWizard.tsx`, `apps/frontend/src/app/app/[adminHash]/tabs/GiveawaysTab.tsx` — UI patterns to mirror

## Verification (once built)

- Devnet dry run: create a small `all`-mode batch (2-3 recipients, one pending-email, one pending-social-handle, one already-registered user) against a devnet SPL mint, confirm funding → compression → claim-link emails → claim → real ATA lands tokens, on both the compressed and pre-existing USDC payment paths (regression-check the latter).
- Devnet dry run: create a small `random_subset`-mode batch (5 recipients, winner_count 2), confirm VRF draw selects 2, only those 2 get compressed + claim links, the other 3 stay `not_selected`.
- Devnet dry run: set a short `claim_deadline_at` on a test batch, let it expire unclaimed, confirm the reclaim job sweeps funds back to the creator and marks recipients `expired`.
- Confirm `resolveClaimNetwork()`'s new branch doesn't affect any existing non-airdrop claim (run existing `claims.service.spec.ts` suite).
- Manually trip and clear the ATA-sponsorship breaker in a controlled test to confirm the runbook works before relying on it live.
