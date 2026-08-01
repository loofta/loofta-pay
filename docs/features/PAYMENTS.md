# Payments

Every payment — public or private — routes through a **one-time burner wallet**. There is no
direct sender → recipient-real-wallet path anymore; the sender always pays into a fresh burner
keypair, and the recipient (or a cron) later sweeps the burner to its final destination. Code
comments in `claims.service.ts` call this "the universal claim architecture."

Primary table: **`payments`** (see [Claims](#claims) for why `claims` still exists).

## Public payments

A plain, visible on-chain USDC transfer from sender to the burner
(`buildUSDCTransferTransaction`, `apps/frontend/src/services/solanaTransfer.ts`), optionally
sponsored by the backend fee payer. The recipient later sweeps burner → their wallet with
another plain SPL transfer (`sweepClaimBurnerToWallet` direct-SPL branch,
`apps/backend/src/modules/claims/claims.service.ts:2154`).

## Private payments

The sender → burner leg goes through **MagicBlock's confidential SPL Private Payments API**
(`payments.magicblock.app`) instead of a visible transfer. Built server-side via
`buildPrivateTransferForPayer()` (`claims.service.ts:1090`), which calls
`requestMagicblockPrivateTransfer` (`apps/backend/src/common/magicblock-private-transfer.ts`)
and returns an unsigned tx for the client to sign — trimmed so MagicBlock routing internals
never leave the backend (`apps/frontend/src/services/magicblockPaymentsApi.ts`).

A **third mode** exists: a payment sent *publicly* can still be **claimed privately** by the
recipient — routes through `sweepClaimBurnerPrivately()` instead of the plain-SPL sweep,
triggered by `claimAsRecipient(..., { claimPrivately: true })`. Cross-chain payments (ETH/BTC →
Solana via NEAR Intents) are always forwarded privately regardless of that flag.

Frontend flag: `PRIVATE_PAYMENT_ENABLED` (`apps/frontend/src/services/privatePayment.ts`),
gated by `NEXT_PUBLIC_ENABLE_PRIVATE_PAYMENT`.

Related but distinct: `apps/backend/src/modules/private-balance/` lets a user hold a
**persistent** MagicBlock private balance (deposit/withdraw), not tied to a specific claim —
see [Users → Withdraw](USERS.md#withdraw).

**Note:** `apps/frontend/src/components/payments/` is an empty leftover directory — the real
payment UI lives in `app/app/page.tsx` (send), `app/app/c/[id]/page.tsx` (claim), and
`app/app/claim/ClaimPageContent.tsx`.

## Claims

`payments` is the **primary/current** table; `claims` is a **legacy** table kept for
backward-compat reads only (see memory: [payments is primary table, claims is legacy]).
Migrations: `20260423200000_create_payments_tables_and_migrate_claims.sql`,
`20260425000000_migrate_legacy_claims_to_payments.sql`.

`SupabaseService` exposes both `.claims` and `.payments` getters. `ClaimsService` has a
dual-table compatibility layer:
- `fetchRawRow(id)` — tries `payments` by id, then by `short_id`, then falls back to legacy
  `claims` by id.
- `updateRow(id, paymentsData, claimsData)` — updates `payments` first; only touches `claims`
  if that update affected zero rows.
- `updateStatus()` strips payments-only columns (`from_token`, `fee_paid_usdc`,
  `naira_claim_bank_account_id`, `naira_claim_fee_usdc`) before falling back to legacy
  `claims` — **any new payments-only column must be added to that strip list** or legacy
  fallback updates will error.

**Creation** (`create()` / `createFromUsername()` / `createFromEmail()` / `createFromSocial()`):
inserts into `payments` with `status: 'OPEN'`, generates an 8-char `short_id`
(`generateShortId()`), and always creates a burner (see
[Burner logic & DB encryption](#burner-logic--db-encryption)). Unregistered recipients get a
sentinel `recipient_address`: `PENDING_EMAIL:`, `PENDING_USERNAME:`, or
`PENDING_SOCIAL:<platform>:<handle>`.

**Redemption** — `claimAsRecipient(claimId, privyUserId, opts)` (`claims.service.ts:1322`):
1. Verifies the caller is the intended recipient.
2. Resolves the sweep destination — caller's own wallet, an explicit external
   `destinationAddress`, or (if `claimToNaira`) the PAJ Cash default bank account's abstracted
   wallet address.
3. Acquires a recipient claim lock (`recipient_claim_lock_at`, compare-and-swap) so a
   concurrent [recipient edit](#recipient-edit) by the sender can't race a claim in flight.
4. Stamps `claim_requested_at` / `claim_requested_privately` / `claim_requested_destination` —
   used by the cron sweep-retry so a resumed claim sweeps to the *right* destination instead of
   silently defaulting (real incident: claim `3d05bc19` swept to the wrong place before this
   bookkeeping existed).
5. Calls `sweepClaimBurnerToWallet()`. On success → `status: 'SUCCESS'`; if funds haven't
   landed yet → `PRIVATE_TRANSFER_PENDING` + `scheduleBackgroundSweepRetry()` (polls every 5s).

Statuses: `OPEN | PENDING_DEPOSIT | IN_FLIGHT | PRIVATE_TRANSFER_PENDING | SUCCESS | REFUNDED |
EXPIRED | CANCELLED | DELETED`.

Sender can reclaim an unclaimed payment: `reclaimByCreator()` (eligibility via
`getReclaimEligibility()`). Admin surface: `admin-claims.controller.ts`
(`ADMIN_API_KEY`-protected).

## Claim to bank (Nigeria — PAJ Cash)

"Claim in Naira" is implemented **inside** `claimAsRecipient()` / `sweepClaimBurnerToWallet()`
— it is not a PAJ order. The backend resolves the caller's **default** PAJ bank account
server-side (`PajCashBankService.getDefaultAccount`, never a client-supplied address) and
reuses the same burner → destination sweep, pointed at the bank account's abstracted
`wallet_address` (a PAJ-managed address — USDC sent there auto-converts and pays out to the
linked Naira account, no separate off-ramp order needed).

`payments.naira_claim_bank_account_id` / `naira_claim_fee_usdc` record that this happened.
`recordNairaClaimOrder()` best-effort inserts a `paj_cash_orders` row afterward purely for the
recipient's withdrawal-history UI — nothing else would create one for this path.

**Fee**: `computeLooftaFeeUsdc()` (`apps/backend/src/common/paj-cash-fee.ts`) — free under $5,
10bps $5–$50, 7bps $50–$500, 5bps above (backend is source of truth; mirrored display-only in
`apps/frontend/src/lib/pajCashFee.ts`). Taken by splitting the on-chain sweep into two SPL
transfer instructions in one transaction (fee leg to the fee-payer's USDC ATA, net leg to
PAJ's abstracted address).

No webhook exists for PAJ reconciliation generally — see [CRON](#cron). See also the repo's
`paj-cash` skill for the full onramp/offramp reconciliation model.

## Short URL / share URL

`generateShortId(length=8)` is **duplicated verbatim** in both `claims.service.ts:69` and
`send-payment.service.ts:41` (same custom base-62-ish alphabet, rejection-sampled to avoid
modulo bias) — a documented convention of this codebase, not an oversight.

Two link shapes exist and are **not interchangeable**:
- Claims → `${baseUrl}/c/${shortId}` → `apps/frontend/src/app/app/c/[id]/page.tsx` (the actual
  claim/redeem page; accepts either short_id or UUID).
- Multi-send → `${baseUrl}/share/${paymentId}` — uses the **raw UUID, not the short_id**
  (minor inconsistency worth knowing about).

`/share/[short_id]` is a separate route (`apps/frontend/src/app/app/share/[short_id]/page.tsx`)
for **social-preview cards**: OG image at `api/share/[short_id]/og/route.tsx`, built on
`getSharePreview()` (`apps/frontend/src/lib/sharePreview.ts`) — privacy-conscious, never
returns email or wallet address, only username/social handle/amount/status.

`baseUrl` defaults to `https://pay.loofta.xyz` (`NEXT_PUBLIC_BASE_URL`).

`apps/link` is a **separate app/deployment** (own Vercel project, `link.loofta.xyz`) — a
standalone claim experience for integrator/x402 agent payments. It never provisions a
Loofta-managed embedded wallet and holds no DB credentials; it calls the backend's public
`/claims/:id/summary` and `/claims/:id/claim` directly.

## Min amount

**$5.00 USDC minimum, enforced inconsistently:**
- Client-side hardcoded in three places (`app/app/page.tsx`, `ClaimPageContent.tsx`,
  `app/app/c/[id]/page.tsx`).
- Backend DTO (`CreateClaimDto.amount`) only enforces `@Min(0.01)` — the $5 floor is **not**
  enforced there.
- Enforced server-side only in `buildPrivateTransferForPayer()`
  (`BadRequestException` under $5, with a carve-out for multi-send batch rows).
- Multi-send: `MULTI_SEND_MIN_TOTAL_USD = 5` via a custom `MinTotalAmount` validator on the
  DTO — sums all recipient amounts, requires the **total** ≥ $5 (individual rows only need
  `@Min(0.01)`).

**Gap:** a plain public single payment created directly via API (e.g. an integrator hitting
`POST /claims/create`) has **no server-side $5 floor at all** — only client UI stops normal
users from going under it.

## Burner logic & DB encryption

`createClaimBurner()` (`claims.service.ts:622`): `Keypair.generate()`, secret encrypted,
stored as `claim_burner_address` / `claim_burner_encrypted_secret`. **If encryption isn't
configured, burner creation is silently skipped** (logged as a warning only) — claiming will
later fail. This is a real operational gotcha to watch for in any environment without the
encryption key set.

**Encryption** — `apps/backend/src/modules/send-payment/encryption.service.ts`
(`SendPaymentEncryptionService`), AES-256-GCM:
- **v2 (current)**: per-payment key via HKDF, `context` = the burner's own public key, so
  compromising one payment's derived key never exposes another's. Ciphertext prefixed `"v2:"`.
- **v1/legacy**: master key used directly, still decryptable for backward compat.
- **Key rotation**: `SEND_PAYMENT_ENC_KEY` (new) + `SEND_PAYMENT_ENC_KEY_OLD` (previous);
  decrypt tries new key first, falls back to old.
- `.env.local` file fallback for the key is **explicitly disabled in production**
  (`NODE_ENV !== 'production'` guard) — production must source it from real env vars / KMS.

**KMS wrapping** (`apps/backend/src/common/kms-secrets.ts`, called before `NestFactory.create()`
in `main.ts`; see [feedback: Production secrets use GCP KMS] and the founding-engineer
[onboarding checklist](../ONBOARDING_FOUNDING_ENGINEER.md#4-kms-on-devnet) for the devnet gap):
- Wraps `SOLANA_FEE_PAYER_PRIVATE_KEY` and `SEND_PAYMENT_ENC_KEY` (+ optional `_OLD` during
  rotation) via GCP KMS, keyring default `looftapay`.
- **Fails closed in production**: refuses to boot with no `KMS_*` vars at all, or if either
  required secret fails to decrypt — no silent fallback to a stale/plaintext value in prod.
- **Only production-gated** — local/dev always falls back to plaintext env vars, no KMS
  involved at all today.

**Burner rent reclamation**: `cronReclaimFinishedClaimBurners()` — mainnet-only, batches of 10,
for terminal (`SUCCESS`/`CANCELLED`) payments with an unreclaimed burner, closes the burner's
token account(s) and recovers rent to the fee payer.

## Recipient edit

`updateClaimRecipient()` (`claims.service.ts:1534`) — sender-only, lets the sender fix a
typo'd/wrong recipient (email, username, or social handle+platform) on a payment they created.

Works for both still-pending (`PENDING_*`) and already-resolved recipients — editing a resolved
recipient rewrites `recipient_address` back to a fresh `PENDING_*` sentinel.

**Blocked once**: `claim_requested_at` is set (recipient genuinely started claiming — the
load-bearing gate, since the background sweep retry can still be resolving after the lock
itself releases), status is `SUCCESS`/`CANCELLED`, or `recipient_claim_lock_at` is currently
active. Uses the same compare-and-swap pattern as claim-lock acquisition. Only works on
`payments`-table rows, not legacy `claims`. After a successful edit on an already-paid payment,
clears the email de-dupe cache and re-fires the recipient notification.

## Multi-send / bulk send

Two distinct implementations in `send-payment.service.ts`:

**A. Public combined-tx multi-send** (`buildMultiPrivateTransfer` — confusingly named, this
path is actually *public*): one sender-signed transaction with up to 10 transfer instructions.
Registered recipients paid directly; unregistered ones get a fresh burner each. All rows share
one `multi_send_batch_id`, `is_multi_send: true`, `is_private: false`. Confirmed via
`confirmMultiSend()`.

**B. Private "hub" multi-send** (3-step: `createMultiPayments` → `buildMultiSendHubTransfer` →
`confirmMultiSendHub` → `fanOutMultiSendHubTransfer`) — this is the "send to one burner"
pattern: since MagicBlock charges its relay fee **per transfer call, not per batch**, the
sender does **one** private transfer of the batch total to Loofta's own fee-payer wallet (the
"hub"), which then fans out to each recipient's own burner with plain, non-private SPL
transfers (network fee only). On-chain, this only reveals "a known Loofta wallet paid burner
X," never who funded the hub.
- `buildMultiSendHubTransfer`: computes `dynamicLooftaBps` by walking down from
  `MULTI_SEND_LOOFTA_PLATFORM_FEE_BPS` (10 bps) to 0 so the batch never costs more than N
  separate single private transfers would have.
- `fanOutMultiSendHubTransfer` (fire-and-forget): polls the hub's ATA until it covers the
  batch total, then pays each recipient with a **randomized 0–20s jitter delay** specifically
  to prevent an observer correlating a burst of hub outflows to one batch.
- Min total $5, min 2 recipients, max 10.

## Toast notifications

`UnclaimedPaymentToast.tsx` (presentational) + `useUnclaimedPaymentToast.ts` (logic):
fetches `/api/payments/history`, filters `received` rows to `paid_at` truthy **and** either
still holding a `PENDING_*` `recipient_address`, or `status === 'PRIVATE_TRANSFER_PENDING'`
(registered recipient, unswept — no address shown, it's a real wallet). Requiring `paid_at`
avoids flagging months-old, never-funded, pre-burner-architecture claims. React Query, 5-min
staleTime, mounted from `AppShell.tsx`. Re-triggered right after linking a new email/Twitter
identity, since that's exactly when a previously-unmatched pending payment can resolve.

## Privacy fees

Constants in `apps/backend/src/common/magicblock-private-transfer.ts`:
- `MAGICBLOCK_VOLUME_FEE_BPS = 10` — MagicBlock's own cut.
- `MAGICBLOCK_GAS_SOL = 0.002` — MagicBlock's own gasless-relay charge, in **SOL** — this, not a
  dollar figure, is the actual cost; MagicBlock refreshes its own SOL/USD price daily on their
  end when computing what to charge.
- `MAGICBLOCK_GAS_USDC = 0.2` — **not a fee this system charges.** It exists solely as an
  error-handling fallback inside `resolveMagicblockRelayFeeUsdc()` for the case where both
  upstream price feeds (Jupiter, then Binance) are simultaneously unreachable — a case that,
  in practice, essentially never happens (`fetchSolPriceUsd()` has two independent providers).
- `SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS = 10` / `MULTI_SEND_LOOFTA_PLATFORM_FEE_BPS = 10` —
  Loofta's own cut on top, via `platformFeeBps` + `platformFeeAccount` (must be the fee
  collector's **initialized USDC ATA**, not a raw wallet address — an undocumented MagicBlock
  requirement that caused a real bug).
- `ENABLE_SINGLE_PAYMENT_PLATFORM_FEE` / `ENABLE_MULTI_SEND_PLATFORM_FEE` — feature flags, can
  be flipped off if the `platformFeeBps` + `exactOut` combination misbehaves again (it has
  before).
- `PRIVATE_BALANCE_PLATFORM_FEE_BPS = 10` — same 10bps on PER private-balance deposits/
  withdrawals, a deliberately separate constant from the claims-path ones.

**The relay fee is always a live SOL→USD conversion, never a flat number.** Every call site that
builds a real on-chain private transfer prices `MAGICBLOCK_GAS_SOL` at the live SOL/USD rate via
the shared `resolveMagicblockRelayFeeUsdc()` helper. This is what's shown to the user as an
estimate before signing. Two of the four call sites go a step further and don't even rely on
that estimate for the number ultimately reported: `buildPrivateTransferForPayer`
(`claims.service.ts:1155`) and `buildWithdrawal` (`private-balance.service.ts:274`) both decode
the *actual* relay-fee instruction out of the real transaction MagicBlock returns
(`decodeActualSenderDebit()`) and report that ground-truth figure instead — confirmed live
2026-07-31: the estimate correctly computed `0.002 × $73.05`, and the response correctly
reported the larger decoded on-chain figure in its place, tagged `actual-relay` in the backend
logs. `sweepClaimBurnerPrivately`'s exact-in branch (`claims.service.ts:1949`) and
`tryDeliverBurnerBalance` (`private-balance-processor.service.ts:167`) use the live-priced
estimate directly to size the transfer, since MagicBlock's own gasless relay instruction charges
its real fee separately regardless.

As of 2026-07-31 all four call sites route through the shared helper — previously
`claims.service.ts` and `private-balance.service.ts`/`private-balance-processor.service.ts` read
`MAGICBLOCK_GAS_USDC` directly at those sites, which was a bug relative to the rest of the
codebase's design intent (lottery and multi-send fee estimation already lived-priced this),
fixed in the same pass as a second, unrelated bug: `private-balance.service.ts`'s fee-breakdown
response computed `solLamports: Math.round(MAGICBLOCK_GAS_USDC * 1e9)` — a *USD* figure treated
as SOL, overstating the reported recoverable-SOL figure by 100×. Now reads `MAGICBLOCK_GAS_SOL *
1e9`, matching the pattern already correct in `claims.service.ts:1204`.

`send-payment.service.ts:478` and `lottery.service.ts:338` still read `MAGICBLOCK_GAS_USDC`
directly, but both are display-only fee-breakdown estimates explicitly documented as not being
what's actually charged (the real charge is computed by MagicBlock's own `exactOut` gross-up, or
superseded by a frontend-passed value) — left as-is rather than expanded in scope.

**Fee direction**: `fee_on_sender` controls `exactOut` — `true` grosses up the sender's debit
so the recipient gets exactly the requested amount; `false` deducts the fee from the
recipient's receive amount. Non-private-by-default links force `feeOnSender = true` when the
sender opts into private ("the sender's choice, the sender's cost").

Effective total on a private single payment ≈ 20 bps (10 MagicBlock + 10 Loofta) + MagicBlock's
gasless relay charge (0.002 SOL, live-priced in USD) + 0.002 SOL gas (recoverable via
`solRecoveryUsdc` in the returned fee breakdown). PAJ Cash / Naira fees are a **separate**
schedule — see [Claim to bank](#claim-to-bank-nigeria--paj-cash).

## CRON

| Service | Method | Schedule | Purpose |
|---|---|---|---|
| `ClaimProcessorService` | `processPendingClaims` | every minute | Processes NEAR-Intents cross-chain claim deposits. Gated by `AUTO_PROCESS_CLAIMS` (default true). |
| " | `cronSweepPendingBurners` | every minute | Retries burner→recipient sweeps for `PRIVATE_TRANSFER_PENDING` claims — survives server restarts, unlike the old in-process `setTimeout` retry. Re-entrancy guarded. |
| " | `cronReclaimFinishedClaimBurners` | every 10 min | Reclaims ATA rent from terminal, mainnet-only burners, batch of 10. |
| `SwapProcessorService` | `processPendingSwaps` | every minute | Same-chain swaps for claims/organizations. Gated by `AUTO_PROCESS_SWAPS`. |
| " | `expireOpenPayments` | every hour | Marks `OPEN` payments past `expires_at` as `EXPIRED`. |
| `SolanaTxVerifierService` | `verifyPendingTxHashes` | every minute | Verifies `PRIVATE_TRANSFER_PENDING` claims with a saved `sender_tx_hash` directly against Solana RPC. |
| `PrivateBalanceProcessorService` | deposit/withdrawal processing | every minute | Separate PER private-balance feature. **Production-only** — disabled elsewhere to avoid racing prod over shared burner rows. |
| `paj-cash-processor.service.ts` | order reconciliation | every 20s | **Only** reconciliation path for PAJ Cash orders — no webhook exists. |
| `user-deposits-processor.service.ts` | deposit reconciliation | every minute | Adjacent deposits feature — see [Users → Deposit](USERS.md#deposit). |

All are also independently HTTP-triggerable via `cron.controller.ts`
(`CronGuard`-protected) — worth confirming with the team whether an external scheduler and the
in-process `@Cron` decorators are both active simultaneously in production; double-processing
risk is largely mitigated by re-entrancy booleans and idempotent status transitions, but not by
a distributed lock.

---

### Cross-cutting gotchas
1. Two link formats (`/c/{short_id}` vs `/share/{uuid}`) from two services with duplicated
   `generateShortId()` — easy for the two to drift.
2. The $5 minimum is solid on multi-send and the private-transfer builder, client-side-only on
   plain public single sends.
3. `updateStatus()`'s legacy-strip column list must be manually kept in sync with new
   `payments`-only columns.
4. `apps/frontend/src/components/payments/` is an empty leftover directory.
5. Multi-send's public path is named `buildMultiPrivateTransfer` despite building a **public**
   transaction — the actually-private path is the separate 3-step hub flow.
6. The MagicBlock `platformFeeBps`/`exactOut` combination has broken production before — both
   single-payment and multi-send hub paths carry defensive fallback logic around it.
