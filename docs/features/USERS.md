# Users

## Onboarding

**Entry point**: `apps/frontend/src/components/layout/UserSync.tsx`, mounted globally. On auth:
1. Ensures a Solana embedded wallet exists (`useCreateWallet`) if none is found via
   `deriveSolanaEmbeddedAddress`.
2. Calls `POST /api/users/check` (retries at 0/500/1500ms for token readiness) to sync
   `username`, `looUsername`, `twitterUsername`, `ataMigratedMainnet/Devnet` into the Zustand
   `useAuthStore`.
3. Decides whether to show `WelcomeOnboarding` (new users, or returning users without a
   `username`/`skipOnboarding`), gated by localStorage/sessionStorage dismissal keys.

**`WelcomeOnboarding.tsx`**: 5-step modal (welcome → username → "pay a friend" → "top up" →
share link), plus an optional pre-step "add a second sign-in method" (email) if none is linked
(skippable for 8h). Username step: if Twitter is linked, the handle is used read-only;
otherwise the user picks a suffix after a fixed `loo-` prefix (see
[Username loo- prefix](#username-loo--prefix)), validated live against
`POST /api/users/check-username`. Saves via `POST /api/users/setup-username`.

**`UsernameSetupModal.tsx`** is an older standalone variant of the same step — it's rendered by
`UserSync` but `showUsernameModal` is never set `true` anywhere found in the code. Likely dead
now that `WelcomeOnboarding` handles it inline; worth confirming with the team before deleting.

**Backend provisioning** — `UsersService.ensureAppUser` (`users.service.ts:166`): idempotent,
called by mobile clients (mirrored by the frontend's own `/api/users/check` route). No-op if an
`app_users` row already exists. Pulls linked Twitter/email from Privy; detects Seeker-wallet
logins (`wallet_client_type === 'seed_vault'` or `connector_type ===
'solana_mobile_wallet_adapter'`) and encodes them as `loo-skr-xxxxxx` (no login-method column
exists, so this is inferred). Generates a username via `generateUniqueLooUsername`. New rows
get `ata_migrated_mainnet: true, ata_migrated_devnet: true` — "new users are born on mainnet,
no ATA migration needed" (see [Upgrade to mainnet-private](#upgrade-to-mainnet-private-cluster)).

**DB table**: `app_users` (`id`, `privy_user_id`, `email`, `username`, `twitter_username`,
`loo_username`, `total_volume_usd`, `ata_migrated_mainnet`, `ata_migrated_devnet`,
`created_at`). Related: `social_accounts`, `force_update`.

**Known stub**: `UsersController.generateNewWallet`
(`POST /users/me/wallet/generate-new`) always throws
`'New wallet generation is not yet implemented...'` — not built yet, even for a zero-balance
wallet.

## Embedded wallet

Configured in `apps/frontend/src/providers/AuthProvider.tsx`: `embeddedWallets: {
createOnLogin: "users-without-wallets" }` for the default EVM wallet, plus a dedicated
`solana: { createOnLogin: "users-without-wallets", ... }` block, with per-cluster RPC config
matching `NEXT_PUBLIC_SOLANA_CLUSTER`.

Belt-and-braces creation: Privy's `createOnLogin` covers fresh logins; `UserSync.tsx` also
explicitly calls `createWallet()` for any authenticated user whose linked accounts don't yet
include a Solana address (covers users who signed up before Solana embedded wallets existed).

**Server-side wallet resolution** — `UsersService.getSolanaWalletAddress`
(`users.service.ts:358`): fetches the Privy user's linked accounts (Redis-cached ~2 min) and
resolves the Solana address with a priority fallback (`wallet`/`smart_wallet` with a valid
Solana address → `solana_embedded_wallet`/`solana` type → any account with a Solana
chain/address). The wallet address is never exposed directly to the frontend from this
endpoint, though balance endpoints do return it.

For mobile (Solana Seeker), `getMobileWalletAddress` prefers a wallet flagged
`wallet_client_type: 'seed_vault'` over an older, empty embedded wallet on the same Privy user
— avoids showing $0 for a funded Seeker wallet. `.skr` domain resolution (AllDomains/ANS) via
`getSkrDomain`.

## Upgrade to "mainnet-private" cluster

`"mainnet-private"` / `"devnet-private"` are MagicBlock Ephemeral Rollup cluster identifiers
used internally for private-balance/private-payment transfers (e.g.
`magicblock-private-transfer.ts:257`), not literally a "user account cluster" concept.

The user-facing **"upgrade" flow** is a mandatory one-time wallet migration, tracked via two
parallel mechanisms:
- **`useUpdateJun26` + `UpdateJun26Modal.tsx`**: gates on `UPDATE_ID = "1"` (must match backend
  `MAINNET_WALLET_UPDATE_ID`) and cutoff date `2026-06-26`. Users created after the cutoff skip
  it automatically. Shows mainnet/devnet balances, forces withdrawal first if >$0.01, then:
  archives old wallet (`/api/users/archive-wallet`) → creates a fresh wallet
  (`/api/users/create-solana-wallet`) → marks complete (`force_update` table upsert on
  `(user_id, update_id)`).
- **`useAtaMigration`**: separately, per network, checks whether the user's USDC ATA is still
  delegated to MagicBlock's ephemeral rollup and, if so, undelegates it
  (`/api/payments/undelegate-ephemeral-ata`), then persists `ata_migrated_mainnet`/
  `ata_migrated_devnet` on `app_users`. `hasCompletedMainnetWalletUpdate` short-circuits `true`
  for any user with `app_users.created_at >= 2026-06-28`.

**Gotcha**: two different migration cutoff dates float around (`2026-06-26` in the hook vs
`2026-06-28` in the backend's `MIGRATION_CUTOFF`) — worth reconciling. Also the "Jun26"
hook/route naming is now stale relative to the actual `MAINNET_WALLET_UPDATE_ID` constant; a
new engineer shouldn't assume the filename reflects the current cutoff.

## Username "loo-" prefix

**Generation**: `apps/frontend/src/lib/looUsername.ts` (`generateUniqueLooUsername`, client)
and its backend port on `UsersService` — both build `loo-{handle}`, retrying with a numeric
suffix on collision, checking uniqueness against both `username` and `loo_username`.

**Server-side enforcement** in `POST /api/users/setup-username`:
- Regex: `/^(?:[a-zA-Z0-9_]{3,20}|loo-[a-zA-Z0-9_]{1,16})$/`.
- `loo-skr-*` is reserved (403) for genuine Seeker mobile-wallet logins, to prevent
  impersonation.
- A **non-`loo-`** username must exactly match the caller's actual linked Twitter/X handle
  (verified live against Privy) — you cannot self-choose an arbitrary non-prefixed username
  today.
- Always backfills both `loo_username` and `twitter_username` regardless of which is "active,"
  so a user can always fall back to their permanent `loo-` handle.

Enforced consistently in the UI too: `WelcomeOnboarding.tsx`, `UsernameSetupModal.tsx`, and
`ChangeUsernameModal.tsx` all hardcode `LOO_PREFIX = "loo-"`, and disable editing entirely once
a user's active username equals their Twitter handle.

### Requested change: drop the prefix, let everyone pick any username

**Not yet implemented.** No plan, flag, or TODO for removing the prefix exists in the code —
it's currently a deliberate, permanent-identity design: the `loo-` handle is documented in
`setup-username`'s own comments as the user's "permanent backup" identity. Dropping it would
require, at minimum: relaxing the setup-username regex/Twitter-match requirement, deciding how
existing `loo-*` users get remapped (or keep their prefix as a legacy identity), and updating
the reserved-namespace check for `loo-skr-*` Seeker usernames so it doesn't collide with
newly-freed-up short usernames. See memory: [Social handle refactor plan] — a related,
separately-planned refactor (drops the `loo-` prefix, explicit platform picker) exists as a
written plan at `~/.claude/plans/unified-strolling-storm.md`, not yet built.

## Social links

Two storage mechanisms, split by platform:
- **Twitter/X**: mirrored onto `app_users.twitter_username` directly (not `social_accounts`),
  since it also frequently is the primary `username`. Set via `setup-username` or on first
  login in `ensureAppUser`.
- **Discord / GitHub / Telegram / Instagram**: normalized `social_accounts` table (`user_id`,
  `platform`, `handle`; migrations `20260718120000_create_social_accounts.sql`,
  `20260722120000_...`). Written via `/api/users/save-social-handle`, read via
  `/api/users/social-handles`. Backend reads through `UsersService.findSocialHandle` /
  `findBySocialHandle` — used to resolve payments sent to `@handle` on one of these platforms.

**Display**: `SocialPlatformIcon.tsx` (shared SVG glyphs: twitter/discord/github/telegram),
used in `UserMenu`'s "Connect accounts" card and the Telegram relay page. Send-flow platform
picker config: `apps/frontend/src/lib/socialPlatforms.ts` (`SOCIAL_PLATFORMS` = discord,
github, and conditionally telegram).

**Recipient verification**: `UsersService.verifyRecipientIdentityForSendPayment`
(`users.service.ts:472`) checks `social_accounts` first, then falls back to a live Privy OAuth
linked-account check for Discord/GitHub — **not** for Telegram, since Telegram is linked via a
separate relay identity with no Privy linked-account equivalent (see next section).

## Telegram specific case — relay via loofta.com

Telegram's Login Widget is blocked on `.xyz` TLDs, so `pay.loofta.xyz` can't host it directly.
`loofta.com` was registered as an **additional domain on the same Privy app instance** solely
to host `apps/frontend/src/app/telegram-relay/page.tsx`.

Mechanics:
- Uses `useLoginWithOAuth({ provider: "telegram" })` (Privy's generic OAuth path) rather than
  the dedicated `useLoginWithTelegram` hook, which requires a `telegram_auth` dashboard flag
  reportedly "stuck disabled for this app."
- Logging in on `loofta.com` creates a **throwaway, separate Privy session** scoped to that
  domain — shares nothing with the user's real `pay.loofta.xyz` session. The relay only reads
  the Telegram handle off that throwaway session and hands it back.
- Two mutually exclusive modes:
  1. **`token` mode** — connecting Telegram to an already-signed-in account. A single-use,
     5-min-TTL Redis token minted by `/api/users/telegram-relay-token`, consumed by
     `/api/telegram-relay/complete`, which independently re-verifies the handle server-side
     (never trusts a client-supplied handle) and upserts into `social_accounts`.
  2. **`claimId` mode** — a visitor with no account yet proving they own the Telegram handle a
     pending payment was sent to, via `/api/telegram-relay/verify-claim` (checks the claim's
     `recipient_address` starts with `PENDING_SOCIAL:telegram:{handle}` — must match
     `ClaimsService.PENDING_SOCIAL_PREFIX`), then `/api/telegram-relay/attach-verified` once
     they sign in.
- Auto-triggers login with no extra click, guarded against Privy's redirect flow re-triggering
  itself via `sessionStorage` (a `ref` wouldn't survive the page reload after redirect).

**Current WIP state**: `TELEGRAM_SEND_ENABLED` in `socialPlatforms.ts` is gated by
`NEXT_PUBLIC_TELEGRAM_ENABLED` — comment states **"Telegram login is currently broken in
production (Privy dashboard misconfiguration)"** and it's hidden from the send-flow platform
picker in production, while claim-side Telegram linking stays enabled everywhere. Check the
current Privy dashboard state before assuming Telegram send is live.

## Deposit

> NOTE: the live UI is now `components/deposit/DepositSheet.tsx`; `BalanceModal.tsx` is legacy (Peer handoff + history only).

Unified in **`BalanceModal.tsx`** (~4,250 lines) with parallel provider paths, plus
`PaymentDepositView.tsx` as a shared "waiting for deposit" status UI (handles pending/
processing/success/failed/expired, with a manual tx-hash "speed up" fallback).

- **Blink**: `handleBlinkDeposit` uses `@swype-org/deposit`'s SDK client-side; signing proxied
  server-side via `/api/blink/sign` (keeps the signer off the client). No custom backend
  module — SDK-driven.
- **Coinbase Onramp/Offramp**: fetches a session token from `/api/coinbase/session` /
  `/api/coinbase/offramp-session`, opens `pay.coinbase.com` in a popup.
- **NEAR Intents (cross-chain)**: frontend `services/nearIntents.ts` wraps
  `@defuse-protocol/one-click-sdk-typescript` directly against `ONECLICK_API_BASE`
  (`https://1click.chaindefuser.com`). Mirrored server-side in
  `apps/backend/src/modules/intents/near-intents.service.ts`, used by `OfframpService` and
  `PrivateBalanceService` for bridge quotes rather than the top-up UI, which talks to 1Click
  directly from the client.
- **PAJ Cash (NGN on-ramp)**: `PajCashOnrampView.tsx` + `services/pajCash.ts`, hitting
  `PajCashService`/`PajCashController`. Session/KYC/bank-account flow creates `paj_cash_orders`
  rows (`direction: 'ON_RAMP'`). See the repo's `paj-cash` skill for the full model.

**DB tables**: `user_deposits` (`type`, `status: pending|complete|failed|cancelled`,
`deposit_address`, `bridge_status`, `amount_usdc`), `paj_cash_orders` /
`paj_cash_sessions` / `paj_cash_bank_accounts` (service-role only, no client-side PostgREST).

**Reconciliation gotcha**: `UserDepositsProcessorService` is a per-minute cron whose docstring
explains the problem it patches — `user_deposits` rows are normally only updated by a
**client-side poll in `BalanceModal.tsx`**, keyed on non-persisted React state. If the user
closes the tab mid-bridge, the row stays `pending` forever even after the swap actually
settles. The cron only runs when `NODE_ENV === 'production'`.

## Withdraw

- **Regular USDC-on-Solana / NEAR-Intents cross-chain**: driven from `BalanceModal.tsx`'s
  `handleWithdraw`, with `withdrawMethod` one of `"usdc-sol" | "near-intents" |
  "peer-offramp" | "private-relay" | "paj-cash"`. Persisted to the **`withdrawals`** table
  (`amount_usdc`, `tx_signature`, `destination_address`, `destination_chain`,
  `destination_token`, `near_intents_status`, etc.) — the client PATCHes bridge status as it
  polls, same "client-driven, cron-reconciled" pattern as deposits.
- **Peer offramp (ZKP2P, `"peer-offramp"`)**: `OfframpService` — non-custodial: bridges Solana
  USDC → the **user's own** Base wallet via NEAR Intents, funds it with a little ETH gas if
  needed, then the user signs a ZKP2P deposit/withdraw on Base directly. Backend tracks state
  in `offramp_requests` (`PENDING_BRIDGE → BRIDGING → DEPOSITED → COMPLETE`, or
  `CANCELLING/CANCELLED/FAILED`), with a cron polling the ZKP2P escrow contract on Base.
- **Private withdraw (`"private-relay"`, USDC private)**: `PrivateBalanceService
  .buildWithdrawal` (`private-balance.service.ts:209`) — resolves the user's real wallet
  server-side (never a client-supplied sender), generates a one-time burner keypair (secret
  encrypted the same way as claim burners — see [Payments → Burner
  logic](PAYMENTS.md#burner-logic--db-encryption)), and calls
  `requestMagicblockPrivateTransfer` with `exactOut: true, gasless: true` against the
  `mainnet-private`/`devnet-private` MagicBlock cluster. Loofta's own 10bps cut
  (`PRIVATE_BALANCE_PLATFORM_FEE_BPS`) requires the fee-collector's **initialized USDC ATA**,
  not its raw wallet address — an undocumented MagicBlock requirement that previously caused an
  `InvalidAccountData` bug. Persisted to `private_transfers` (`direction: 'withdrawal'`).
  - **Cross-chain deposits/withdrawals are dead-guarded**: `startDeposit`/`buildWithdrawal`
    throw a "coming soon" error whenever a cross-chain `source_token`/`destination_token` is
    set. The code paths are fully implemented but disabled — comment: "disabled until
    failed/refunded bridges have an automated recovery path; a failed cross-chain deposit today
    refunds into the burner in the ORIGINAL source token, which nothing currently detects or
    sweeps."
- **PAJ Cash withdraw (Naira exit)**: `PajCashOfframpView.tsx` +
  `PajCashService.createOfframp`/`getOfframpValue` — mirrors onramp, writing `paj_cash_orders`
  rows with `direction: 'OFF_RAMP'`. (Distinct from "claim to bank," see
  [Payments → Claim to bank](PAYMENTS.md#claim-to-bank-nigeria--paj-cash), which bypasses order
  creation entirely.)

**Cross-cutting pattern**: three separate money-movement subsystems (`user_deposits`/
`withdrawals`, `offramp_requests`, `private_transfers`) each reconcile pending cross-chain state
with their own cron — "client polls happily until it doesn't, so a server cron double-checks."
Worth understanding as one recurring architectural idiom, not three unrelated one-offs, when
auditing for gaps.
