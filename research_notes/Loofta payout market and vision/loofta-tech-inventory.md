# Loofta Technical Capability Inventory (code-verified, repo snapshot 2026-10-13, HEAD `d472e770`)

Status legend: **LIVE** = wired in UI/API and enabled · **GATED** = behind feature flag / env / admin allowlist · **PARTIAL/STUB** = partly built, placeholder, or design-only · **DEAD/LEGACY** = removed, unreachable, or kept for backward compatibility only.

Sources are repo-relative file paths (repo root `/Users/Lisa.Bechina/- Projects/loofta-swap`). Docs = `docs/features/*.md`; **code wins where they disagree**. Live DB was not queried. Backend = NestJS `apps/backend`, frontend = Next.js `apps/frontend`, DB migrations = `apps/backend/supabase/migrations` (186 files).

Backend modules registered in `AppModule` (all mounted): organizations, claims, intents, tokens, cron, users, send-payment, rewards, waitlist, twitter-payments, twitter-autopay, twitter-ticket-gifts, offramp, jupiter, lottery, magicblock-quest, integrators, private-balance, paj-cash, user-deposits, nest, giveaways, marketing, payment-links, payouts, fomo — [app.module.ts](apps/backend/src/app.module.ts). Other apps: `apps/link` (standalone claim app), `apps/sdk` (`@loofta/pay-sdk`), `apps/mobile` (Expo + `@privy-io/expo`), `apps/seeker-pay` (empty: only `.gitignore` — STUB), `apps/twitter-bot`, `apps/video`, `apps/Logos`, plus an on-chain Anchor program `programs/loofta-vrf`.

Working-tree note (uncommitted as of this snapshot): `users.service.ts` now treats an email-only Privy account as registered even without a username (previously pay-target / `createFromEmail` added the $0.10 claim fee). Frontend fee helpers (`unregisteredAccountFee.ts`, `lookupPayTarget.ts`, `SendPage.tsx`, `HomeV3Content.tsx`) were also being edited. Inventory below reflects **current working tree + HEAD**.

**Largest docs/code disagreements (read these first):**
1. [PAYMENTS.md](docs/features/PAYMENTS.md) still says every payment goes through a one-time burner and “there is no direct sender → recipient-real-wallet path anymore.” Current `ClaimsService` pays **registered** recipients **directly** to their Solana wallet — no burner, no claim step, no $0.10 fee — via `insertDirectRegisteredPayment`. Burners remain only for unregistered / pending identifiers. — [claims.service.ts](apps/backend/src/modules/claims/claims.service.ts)
2. [PAYMENTS.md](docs/features/PAYMENTS.md) still describes private multi-send as a transfer into Loofta’s shared fee-payer “hub.” Code was redesigned after a 2026-08-19 drain: private multi-send now funds a **per-batch throwaway burner**, never the shared fee-payer. — [send-payment.controller.ts](apps/backend/src/modules/send-payment/send-payment.controller.ts), [send-payment.service.ts](apps/backend/src/modules/send-payment/send-payment.service.ts)
3. [SEND_PAYMENT_AND_PRIVATE_FLOW.md](docs/SEND_PAYMENT_AND_PRIVATE_FLOW.md) describes a Privacy Cash / `send_payment_links` vault path. That path is **DEAD**. Live privacy is MagicBlock (`payments.magicblock.app`). `send-payment` is now the multi-send module only.
4. [LOTTERY.md](docs/features/LOTTERY.md) is correct that regular ticket purchases collect **no Loofta service fee**. Leftover `looftaTicketFee` ($0.03 + 150 bps) and `POST /lottery/buy-fee-confirm` still exist in the backend; the web buy UI no longer calls them. The Megapot page FAQ still advertises “$0.10 + 0.3%” — stale copy. — [lottery.service.ts](apps/backend/src/modules/lottery/lottery.service.ts), [megapot/page.tsx](apps/frontend/src/app/app/megapot/page.tsx)
5. Agent skill copy still prices private gas as a flat “~$0.20”; code live-prices **0.002 SOL**. Skill also says custom-domain claim-page whitelabel is not self-serve (true for *domain*), while name/logo branding **is** self-serve. — [skillContent.ts](apps/frontend/src/app/docs/skillContent.ts)
6. [ADMIN.md](docs/features/ADMIN.md) says the Twitter bot hardcodes `is_devnet: true`. Code derives it from the integrator row `is_devnet_only`. — [twitter-bot/src/index.ts](apps/twitter-bot/src/index.ts)
7. [ADMIN.md](docs/features/ADMIN.md) lists `MAGICBLOCK_GAS_USDC = 0.2` as a “flat relay fee”; [PAYMENTS.md](docs/features/PAYMENTS.md) and [magicblock-private-transfer.ts](apps/backend/src/common/magicblock-private-transfer.ts) say the real charge is 0.002 SOL live-priced.
8. [USERS.md](docs/features/USERS.md) says Telegram is “hidden in production”; code hides it only if `NEXT_PUBLIC_TELEGRAM_ENABLED === "false"`. Production Vercel env is not in the repo.

---

## 1. Payments: pay-by-handle, burner claim architecture, guest send, links/checkout, recipient edit

### Takeaway
The shipped rail is “pay anyone by identifier.” **Registered** Loofta users are paid straight to their Privy Solana wallet. **Unregistered** email / username / social handles get a one-time encrypted burner plus a claim link. Guest (no-account) sending, merchant checkout links with signed webhooks, sender-side recipient edit, reclaim, 2–10 recipient multi-send, and a fomo.family handle pay page are LIVE.

### Cited Findings
- **Registered = direct wallet (LIVE; docs stale):** `createFromUsername` / `createFromEmail` / `createFromSocial` resolve the user, then `insertDirectRegisteredPayment` writes `recipient_address` = their Solana wallet, `burnerAddress: null`, `payTo` = that wallet unless the payment is private. Comment: “Registered recipient: USDC goes to their wallet. No burner, no claim step, no $0.10.” If the user set `require_private_payments`, the payer can only send privately and `fee_on_sender = true`. Working-tree `findByEmail` now treats a Privy id as registered even without a username (email-only signups). — [claims.service.ts](apps/backend/src/modules/claims/claims.service.ts); [users.service.ts](apps/backend/src/modules/users/users.service.ts)
- **Unregistered = burner + PENDING_* sentinel (LIVE):** `PENDING_EMAIL:`, `PENDING_USERNAME:`, `PENDING_SOCIAL:<platform>:<handle>`; `createClaimBurner()` = `Keypair.generate()`, secret stored as `burner_address` / `burner_encrypted_secret`. If `SEND_PAYMENT_ENC_KEY` is missing, burner creation is skipped and claiming later fails. `recipient_was_unregistered: true` is stamped on these rows. — [claims.service.ts](apps/backend/src/modules/claims/claims.service.ts), [PAYMENTS.md](docs/features/PAYMENTS.md)
- **Recipient types (LIVE):** email, Loofta username (`loo-…`), X/Twitter, Discord, GitHub, Telegram. Payouts API accepts the same set. X is routed through username lookup with `treatUnregisteredAsTwitter: true`. — [payouts.service.ts](apps/backend/src/modules/payouts/payouts.service.ts), [create-payout.dto.ts](apps/backend/src/modules/payouts/dto/create-payout.dto.ts)
- **Pay-target lookup (LIVE):** public `GET /users/pay-target?kind=email|username|twitter|social` returns `{ registered, requirePrivatePayments }` with no wallet/email leak. Frontend `lookupPayTarget` treats a typed email as email even if the Social tab is selected (avoids a false $0.10 fee). — [users.controller.ts](apps/backend/src/modules/users/users.controller.ts), [lookupPayTarget.ts](apps/frontend/src/lib/lookupPayTarget.ts)
- **Recipient can require private payments (LIVE):** `GET/POST /users/me/private-payments`. — [users.controller.ts](apps/backend/src/modules/users/users.controller.ts)
- **fomo.family handle pay (LIVE, not in PAYMENTS.md):** `GET /fomo/resolve/:handle` proxies `getfomoapi.fun` (key server-side); `/fomo` page pays the resolved Solana wallet directly via `DirectWalletPayPanel` — “Loofta never holds it.” Guest wallet connect, optional MagicBlock split/delay. Recipient needs no Loofta account. — [fomo.service.ts](apps/backend/src/modules/fomo/fomo.service.ts), [fomo.controller.ts](apps/backend/src/modules/fomo/fomo.controller.ts)
- **Telegram send: GATED (env).** `TELEGRAM_SEND_ENABLED = NEXT_PUBLIC_TELEGRAM_ENABLED !== "false"` — **enabled unless the env is exactly `"false"`**. Comment: hide from send pickers in production because Telegram login is broken (Privy dashboard). Claim-side Telegram linking stays on. — [socialPlatforms.ts](apps/frontend/src/lib/socialPlatforms.ts)
- **Telegram relay via loofta.com (LIVE workaround):** Telegram Login Widget blocked on `.xyz`; `telegram-relay/page.tsx` on loofta.com uses a throwaway Privy session. Token mode (5-min Redis) and claimId mode. — [USERS.md](docs/features/USERS.md)
- **Instagram: PARTIAL.** Stored in `social_accounts` (`WRITABLE_PLATFORMS` = discord/github/instagram). Send picker is only discord / github / (optional) telegram. Docs page: “TikTok and Instagram are coming.” — [save-social-handle/route.ts](apps/frontend/src/app/api/users/save-social-handle/route.ts), [socialPlatforms.ts](apps/frontend/src/lib/socialPlatforms.ts), [SendPayments.tsx](apps/frontend/src/app/docs/sections/SendPayments.tsx)
- **Redemption (LIVE, unregistered path):** `claimAsRecipient()` verifies identity, destination = own wallet / external address / PAJ Naira default bank wallet, CAS lock on `recipient_claim_lock_at`, stamps `claim_requested_*`, sweeps; else `PRIVATE_TRANSFER_PENDING` + cron. Statuses: `OPEN | PENDING_DEPOSIT | IN_FLIGHT | PRIVATE_TRANSFER_PENDING | SUCCESS | REFUNDED | EXPIRED | CANCELLED | DELETED`. — [PAYMENTS.md](docs/features/PAYMENTS.md)
- **Sender reclaim (LIVE):** `reclaimByCreator()` / `getReclaimEligibility()`. Recipient edit (LIVE): `updateClaimRecipient()` sender-only; blocked once `claim_requested_at` is set, status SUCCESS/CANCELLED, or lock active. Same pattern for lottery gifts. — [PAYMENTS.md](docs/features/PAYMENTS.md)
- **Guest send (LIVE):** unauthenticated `POST /claims/create-from-email-guest`, `create-from-social-guest`, `create-from-username-guest` (Twitter-only; Loofta username is not a guest-pickable method). Cloudflare Turnstile required (refuses if `TURNSTILE_SECRET_KEY` unset); 5/min/IP. UI: `GuestSendPayButton.tsx`. — [claims.controller.ts](apps/backend/src/modules/claims/claims.controller.ts), [createClaimGuest.ts](apps/frontend/src/lib/createClaimGuest.ts)
- **Multi-send (LIVE, redesigned):** public combined-tx path (up to 10 transfers; still named `buildMultiPrivateTransfer` despite being public). Private path: one MagicBlock transfer into a **per-batch throwaway burner**, then fan-out. Controller comment (2026-08-22): old shared-hub had a fund-drain + double-pay; redesign uses per-batch burner + row-level idempotent fan-out. Re-enabled on mainnet 2026-08-22 “ahead of a completed devnet verification pass.” Min 2, max 10, total ≥ $5. Recipient types: email, twitter, username, discord, github, telegram. — [send-payment.controller.ts](apps/backend/src/modules/send-payment/send-payment.controller.ts), [multi-send-build.dto.ts](apps/backend/src/modules/send-payment/dto/multi-send-build.dto.ts)
- **Minimums:** public $0.01 (`@Min(0.01)`), private $1.00, multi-send total $5, payouts API $0.01–$10,000. — [PAYMENTS.md](docs/features/PAYMENTS.md), [create-payout.dto.ts](apps/backend/src/modules/payouts/dto/create-payout.dto.ts)
- **Links:** claim `/c/{short_id}` (8-char), multi-send `/share/{uuid}`, OG cards at `/share/[short_id]`. Base `https://pay.loofta.xyz`. Standalone claim app `apps/link` (link.loofta.xyz) — no embedded wallet, no DB creds; calls `/claims/:id/summary` and `/claims/:id/claim`. — [PAYMENTS.md](docs/features/PAYMENTS.md)
- **Merchant checkout / payment links (LIVE):** `POST /payment-links` (API key, `{amount, message, webhook_url, return_url, is_private}`), `GET /payment-links/:shortId`. One-time `webhook_secret`; signed `payment.succeeded` with `X-Loofta-Signature`. Rate 20 create / 60 poll per minute per integrator. Checkout `app/app/checkout/[id]`, guest pay with email + any NEAR-Intents token or Solana USDC. One link = one amount, not reusable. — [payment-links.controller.ts](apps/backend/src/modules/payment-links/payment-links.controller.ts), [skillContent.ts](apps/frontend/src/app/docs/skillContent.ts)
- **Merchant branding (LIVE, self-serve name/logo):** `GET/POST /integrators/self-serve/branding` writes an `organizations` row lazily. Custom-domain / fully unbranded claim page is **not** self-serve (skill says email hello@loofta.xyz). — [self-serve-integrators.controller.ts](apps/backend/src/modules/integrators/self-serve-integrators.controller.ts)
- **Twitter mention-to-pay (GATED per integrator):** `apps/twitter-bot` parses `@looftapay send $X to @handle`. `is_devnet` is **not** hardcoded; derived from the integrator row `is_devnet_only`. — [twitter-bot/src/index.ts](apps/twitter-bot/src/index.ts)
- **Twitter autopay (GATED, admin-only):** enroll/unenroll handles. — [twitter-autopay.service.ts](apps/backend/src/modules/twitter-autopay/twitter-autopay.service.ts)
- **Tables:** `payments` is primary. PAYMENTS.md still describes a dual-table `claims` fallback; a `drop_legacy_claims_tables.sql` migration exists. `ClaimsService` dual-table helpers may now be DEAD. Not verified against prod DB.
- **Empty leftover:** `apps/frontend/src/components/payments/` is empty; real UI is `SendPage.tsx`, `home-v3/HomeV3Content.tsx`, `app/app/c/[id]/page.tsx`, `ClaimPageContent.tsx`. — [PAYMENTS.md](docs/features/PAYMENTS.md)

### Inferences
- The reusable primitive is “resolve identifier → if registered, pay wallet; else escrow-to-burner + claim.” Payouts API, giveaways, lottery gifts, twitter-payments and multi-send all sit on `ClaimsService.createFrom*`.
- PAYMENTS.md is a useful architecture map for the *unregistered* path and cron table, but it is stale on the two load-bearing money paths (registered-direct and multi-send custody).
- The $0.10 unregistered fee is the product reason registered-direct was added: do not charge people who already have a wallet.

### Gaps
- Whether Telegram send is actually disabled on production Vercel cannot be determined from the repo.
- Whether the legacy `claims` table still exists in prod (not queried).
- Whether the frontend $0.10 unregistered fee is enforced/collected on-chain by the backend, or only added client-side. Backend stamps `recipient_was_unregistered` but the fee constant lives only in the frontend (`UNREGISTERED_ACCOUNT_FEE_USD`). The fee-payer public address is exposed as “$0.10 claim-fee destination.” If a client omits the extra transfer, the payment may still succeed. — [unregisteredAccountFee.ts](apps/frontend/src/lib/unregisteredAccountFee.ts), [GuestCheckoutPay.tsx](apps/frontend/src/components/app/GuestCheckoutPay.tsx), [claims.controller.ts](apps/backend/src/modules/claims/claims.controller.ts)

---

## 2. Fees charged (complete list found in code)

### Takeaway
Revenue is a pile of per-feature fees with no unified ledger. Highest explicit take-rates: giveaway 10% (min $5) and Peer cash-out 2% (min $0.30). The core payment rail is ~10 bps Loofta + MagicBlock pass-through on private sends, plus a $0.10 unregistered-claim fee collected only by the frontend.

### Cited Findings

| Fee | Amount | Applies to | Status | Source |
|---|---|---|---|---|
| Unregistered account / “claim fee” | **$0.10 flat** | paying an email or social handle that lookup says is not a Loofta account (username and direct wallet skip it). Charged on public and private. Frontend-only constant; skipped if `NEXT_PUBLIC_SOLANA_FEE_ATA_WALLET` unset | LIVE (UI) | [unregisteredAccountFee.ts](apps/frontend/src/lib/unregisteredAccountFee.ts), [SendPage.tsx](apps/frontend/src/app/app/SendPage.tsx), [HomeV3Content.tsx](apps/frontend/src/app/home-v3/HomeV3Content.tsx), [GuestCheckoutPay.tsx](apps/frontend/src/components/app/GuestCheckoutPay.tsx), [c/[id]/page.tsx](apps/frontend/src/app/app/c/[id]/page.tsx) |
| Loofta private single-payment cut | **10 bps**, `ENABLE_SINGLE_PAYMENT_PLATFORM_FEE = true` (re-enabled 2026-07-24) | private sends and private claim sweeps | LIVE | [magicblock-private-transfer.ts](apps/backend/src/common/magicblock-private-transfer.ts) |
| Loofta multi-send cut | **10 bps** (`MULTI_SEND_LOOFTA_PLATFORM_FEE_BPS`), walked down so a batch never costs more than N singles | private multi-send | LIVE | same + [PAYMENTS.md](docs/features/PAYMENTS.md) |
| Loofta private-balance cut | **10 bps** | persistent private-balance deposit/withdraw | LIVE | [private-balance.service.ts](apps/backend/src/modules/private-balance/private-balance.service.ts) |
| MagicBlock pass-through | 10 bps volume + **0.002 SOL** relay, live-priced via Jupiter then Binance (`MAGICBLOCK_GAS_USDC = 0.2` is fallback only) | all private transfers | LIVE | [magicblock-private-transfer.ts](apps/backend/src/common/magicblock-private-transfer.ts) |
| Cross-chain deposit cut | **30 bps** (`CROSS_CHAIN_LOOFTA_FEE_BPS`), waivable | paying a claim from another chain via NEAR Intents | LIVE when that path is used | [deposit.service.ts](apps/backend/src/modules/claims/deposit.service.ts) |
| NEAR Intents app fee | `APP_FEE_BPS` env, **backend default 0** | swaps / intents | GATED by env | [near-intents.service.ts](apps/backend/src/modules/intents/near-intents.service.ts) |
| Payout API TON funding | Loofta cross-chain + NEAR app fee **waived** for `gram_ton` | `/payouts` | LIVE | [payouts.service.ts](apps/backend/src/modules/payouts/payouts.service.ts) |
| PAJ Cash Naira | **0 bps &lt;$5, 10 bps $5–50, 7 bps $50–500, 5 bps &gt;$500** (split fee + net legs in one tx) | claim-to-Naira and PAJ withdraw | LIVE | [paj-cash-fee.ts](apps/backend/src/common/paj-cash-fee.ts) |
| Peer (zkp2p) cash-out | **2% of USDC, min $0.30**, implemented as a negative oracle spread so the filler pays less fiat | Venmo / Cash App / Revolut / Zelle | LIVE | [peerCash.ts](apps/frontend/src/services/peerCash.ts) |
| Giveaway platform fee | **10% of prize pool, min $5**, waived for official Loofta giveaways; collected from leftover burner sweep | giveaways | LIVE | [giveaways.service.ts](apps/backend/src/modules/giveaways/giveaways.service.ts) |
| Lottery ticket Loofta fee | `$0.03 + 150 bps` helper still in code; **regular purchase returns `looftaFeeUsdc: 0`** and absorb bridge from fee-wallet reserve | Megapot tickets | DEAD on buy UI; leftover API `POST /lottery/buy-fee-confirm`; gift fee confirm not called from frontend | [lottery.service.ts](apps/backend/src/modules/lottery/lottery.service.ts) |
| Mystery Pack | **$2** per pack | lottery packs | LIVE | [LOTTERY.md](docs/features/LOTTERY.md) |
| Megapot referral | ~10% referral share on Jackpot (`DEFAULT_REFERRAL_WIN_SHARE_FACTOR = 0.9`); claimed **manually** via Basescan | lottery revenue | LIVE (read) / PARTIAL (claim) | [megapot.service.ts](apps/backend/src/modules/lottery/megapot.service.ts), [ADMIN.md](docs/features/ADMIN.md) |
| Legacy SOL send fee | 0.0015 SOL (`SEND_PAYMENT_FEE_LAMPORTS`) — **no callers outside its own file** | — | DEAD | [send-fee.config.ts](apps/backend/src/modules/claims/send-fee.config.ts) |

- **Stale fee copy still shown to users:**
  - [skillContent.ts](apps/frontend/src/app/docs/skillContent.ts) L197: private payouts add “~10 bps + $0.20 flat gas.”
  - [GiveawayFundSheet.tsx](apps/frontend/src/components/rewards-rail/GiveawayFundSheet.tsx): “MagicBlock relay, 0.10% + $0.20.”
  - [megapot/page.tsx](apps/frontend/src/app/app/megapot/page.tsx) L3283: “Loofta's service fee ($0.10 + 0.3%)” — contradicts `looftaFeeUsdc: 0`.
  - [magicblockPrivateTransfer.ts](apps/frontend/src/services/magicblockPrivateTransfer.ts) still uses `MAGICBLOCK_GASLESS_FEE_FLAT_USD = 0.2` for display estimates.
  - Stale comments in `claims.service.ts` still say the single-payment platform fee is “Currently disabled”; the flag is `true`.

### Inferences
- A B2B product would need a single fee/revenue table. [ADMIN.md](docs/features/ADMIN.md) confirms there is no consolidation service — fees live in payments columns, deposit gross-up math, Megapot on-chain reads, and lottery_tickets columns.
- The $0.10 unregistered fee is the only *flat* fee on the core send rail.

### Gaps
- No subscription / plan pricing for giveaways or API — purely per-event fees. Rewards-rail UI copy mentions “package for 1 week, 4 weeks, or 3 months” and “KYC checks add $1 per verified entrant” — **no backend counterpart**.
- Backend enforcement of the $0.10 fee was not found in NestJS (frontend constructs the extra transfer).

---

## 3. Cash-out / off-ramp and on-ramp

### Takeaway
Shipped exits: Solana USDC withdraw, NEAR-Intents cross-chain withdraw, PAJ Cash Naira (bank), Peer Cash / zkp2p (Venmo, Cash App, Revolut, Zelle — USD only), MoonPay and Coinbase via Privy/popups. On-ramps: Coinbase, MoonPay (Privy), Blink (Swype), PAJ Cash NGN, NEAR-Intents deposit. Card is a waitlist plus a hardcoded-off Jam Card claim placeholder. SP3ND shopping is a partner cart, not a cash-out.

### Cited Findings
- **Withdraw methods (LIVE):** `"usdc-sol" | "near-intents" | "peer-offramp" | "private-relay" | "paj-cash"`, persisted to `withdrawals`. — [USERS.md](docs/features/USERS.md), [BalanceModal.tsx](apps/frontend/src/components/BalanceModal.tsx)
- **PAJ Cash Nigeria (LIVE):** on-ramp `PajCashOnrampView.tsx`, off-ramp `PajCashOfframpView.tsx`, claim-to-Naira inside `claimAsRecipient()` sweeping to PAJ’s abstracted wallet for the user’s **default** bank account (never a client-supplied address). PAJ has its own KYC (`submit-kyc.dto.ts`, `PajCashKycStep.tsx`). Reconciliation = 20 s cron, **no webhook**. SEO pages `app/usdc-to-ngn`, `app/dollar-to-naira-today`. — [PAYMENTS.md](docs/features/PAYMENTS.md), [paj-cash/](apps/backend/src/modules/paj-cash/)
- **Peer Cash / zkp2p (LIVE):** `PEER_PLATFORMS` = Venmo, Cash App, Revolut, Zelle; `PEER_CURRENCIES` = USD only; no Loofta caps (`maxUSDC: null`). Wise and PayPal exist in the SDK but are not offered (need a Peer identity attestation this app cannot create). Zelle is withdraw-only. Direct-pay (`DIRECT_CASH_PLATFORM_IDS`) = venmo, cashapp, revolut. Solana→Base USDC still goes through Loofta’s NEAR Intents bridge because Peer Cash Relay routing is EVM-only. — [peerPlatforms.ts](apps/frontend/src/lib/peerPlatforms.ts), [peerCash.ts](apps/frontend/src/services/peerCash.ts)
- **Legacy OfframpService (LIVE backend):** bridges Solana USDC → user’s own Base wallet via NEAR Intents, tops up ETH gas, user signs zkp2p on Base; `offramp_requests` state machine; public cash-out share links (`offramp_share_short_id`). — [USERS.md](docs/features/USERS.md), [offramp.controller.ts](apps/backend/src/modules/offramp/offramp.controller.ts)
- **Coinbase Onramp/Offramp (LIVE):** `/api/coinbase/session` and `/api/coinbase/offramp-session`, popup to pay.coinbase.com. Guest checkout can also open Coinbase. — [USERS.md](docs/features/USERS.md)
- **MoonPay (LIVE via Privy fund-wallet):** BalanceModal prefers MoonPay; giveaway shortfall quote `api/giveaways/moonpay-quote`. Not in guest checkout (“no standalone MoonPay credentials”). — [BalanceModal.tsx](apps/frontend/src/components/BalanceModal.tsx), [GuestCheckoutPay.tsx](apps/frontend/src/components/app/GuestCheckoutPay.tsx)
- **Blink (LIVE):** `@swype-org/deposit`, signing proxied via `/api/blink/sign`. — [USERS.md](docs/features/USERS.md)
- **Loofta Card waitlist (PARTIAL/STUB):** `/app/card` = “Apply for early access”; copy “Minimum KYC, $30 one-time fee, Private spending”; `api/card/early-access` writes `mainnet_waitlist`. No issuer integration. — [LooftaCardDetail.tsx](apps/frontend/src/components/app-home/LooftaCardDetail.tsx)
- **Jam Card claim destination (DEAD/off):** `SHOW_CRYPTO_CARD_CLAIM = false` in the claim page. Comment: “UI placeholder only, no real payout wired up yet. Jam's card network (Visa/Mastercard), partner API, and KYC field requirements are still unconfirmed.” — [c/[id]/page.tsx](apps/frontend/src/app/app/c/[id]/page.tsx), [JamCard3D.tsx](apps/frontend/src/components/jam-card/JamCard3D.tsx)
- **SP3ND shop (PARTIAL):** partner cart/order API (`SP3ND_API_KEY` / `SP3ND_API_SECRET`) at `api/partners/sp3nd/{cart,order,shipping}`. Spend destination, not a fiat off-ramp. — [sp3nd/client.ts](apps/frontend/src/app/api/partners/sp3nd/client.ts)

### Inferences
- Fiat coverage is US P2P (non-custodial zkp2p) + Nigeria bank (PAJ) + global MoonPay/Coinbase. Recipients of a payout can already cash out without Loofta issuing cards or holding fiat.
- Two card products exist as marketing/placeholders (Loofta Card waitlist; Jam Card claim dest) — neither moves money.

### Gaps
- No EUR/GBP/other Peer currencies. No Loofta-owned ACH/SEPA/wire. No card issuing.

---

## 4. Cross-chain (NEAR Intents) and swaps

### Takeaway
NEAR Intents 1Click is integrated client- and server-side for deposits, withdrawals, guest checkout, and API payout funding (`gram_ton`, `usdc_base`). **In-app cross-chain sending is GATED off** unless `NEXT_PUBLIC_CROSS_CHAIN_ENABLED=true`. Jupiter swaps SPL tokens (giveaway prizes). Relay/Li.Fi/Rhinestone power Solana↔Base for Megapot.

### Cited Findings
- **Cross-chain payments flag (GATED):** `CROSS_CHAIN_ENABLED = NEXT_PUBLIC_CROSS_CHAIN_ENABLED === "true"`; comment: “Disabled on mainnet beta — burner + auto-sweep not yet wired for registered users.” — [features.ts](apps/frontend/src/lib/features.ts)
- **NEAR Intents:** frontend `services/nearIntents.ts` (`https://1click.chaindefuser.com`), backend `near-intents.service.ts`. Checked-in 1Click tokenlist: **88 unified assets**, **36 chain names**: adi, aleo, aptos, arbitrum, aurora, aurora_devnet, avalanche, base, berachain, bitcoin, bsc, dash, easychain, eth, gnosis, hako, hyperliquid, layerx, monad, near, optima, optimism, plasma, polygon, scroll, solana, starknet, stellar, sui, ton, tron, turbochain, tuxappchain, vertex, xrpledger, zcash. Wallet-connect families: EVM / TON / Bitcoin / other. — [production.json](apps/frontend/src/config/tokenlist/production.json), [chains.ts](apps/frontend/src/lib/chains.ts)
- **Payout API funding (LIVE):** `funding_source` = `gram_ton` (native TON, labeled GRAM) or `usdc_base`; TON chosen over USDT jetton after a stuck deposit 2026-09-09. — [payouts.service.ts](apps/backend/src/modules/payouts/payouts.service.ts)
- **Private-balance cross-chain (DEAD-GUARDED):** implemented but throws “coming soon” until failed-bridge recovery exists. — [USERS.md](docs/features/USERS.md)
- **Lottery Base bridge (LIVE, env-selected):** `BRIDGE_PROVIDER === 'relay' ? 'relay' : 'lifi'` — **code fallback is Li.Fi**, deployed env is Relay. Rhinestone-sponsored userOps on Base. — [LOTTERY.md](docs/features/LOTTERY.md)
- **Jupiter (LIVE):** backend module + `giveaway-token.service.ts` `swapUsdcForToken()` for SPL prizes.

### Gaps
- Which subset of the 88-asset tokenlist is actually offered in each UI (BalanceModal vs guest checkout vs swap widget) was not enumerated screen-by-screen.
- Production value of `NEXT_PUBLIC_CROSS_CHAIN_ENABLED` is not in the repo.

---

## 5. Privacy (MagicBlock)

### Takeaway
MagicBlock confidential SPL is the live privacy stack: single sends, private claims, private multi-send, persistent private balance, lottery buys, giveaway funding, payouts API. Frontend toggle is env-gated. Privacy Cash (the old ZK deposit path) is dead.

### Cited Findings
- Sender→burner (or sender→registered wallet) via `requestMagicblockPrivateTransfer` (`payments.magicblock.app`). Public-send / private-claim via `sweepClaimBurnerPrivately()`. `exactOut: true` so recipient nets exactly `amount`. — [magicblock-private-transfer.ts](apps/backend/src/common/magicblock-private-transfer.ts)
- Frontend flag `PRIVATE_PAYMENT_ENABLED` from `NEXT_PUBLIC_ENABLE_PRIVATE_PAYMENT` === `"true"` or `"1"`. — [privatePayment.ts](apps/frontend/src/services/privatePayment.ts). Status: **GATED (env)**.
- **Private balance (LIVE, prod-only cron):** persistent MagicBlock balance, `private_transfers` table. — [private-balance/](apps/backend/src/modules/private-balance/)
- **Split / delay (LIVE):** MagicBlock `maxDelayMs` / `private_split` (capped at 15 splits); best-effort persist so missing columns do not fail payment creation. Used on Send, `/fomo`, GuestCheckoutPay, claim page. — [claims.service.ts](apps/backend/src/modules/claims/claims.service.ts), [privacyDelay.ts](apps/frontend/src/lib/privacyDelay.ts)
- Incognito-mode UI toggle. Stealth-address columns were added then removed — DEAD.
- Address risk screening via Range (`https://api.range.org/v1/address`) on withdrawals and claim page. Privacy policy and terms claim Range is used for sanctions screening. — [api/risk/address/route.ts](apps/frontend/src/app/api/risk/address/route.ts), [privacy/page.tsx](apps/frontend/src/app/privacy/page.tsx), [terms/page.tsx](apps/frontend/src/app/terms/page.tsx)

### Gaps
- Whether `NEXT_PUBLIC_ENABLE_PRIVATE_PAYMENT` is true in production is not in the repo.
- Range screening is address-risk, not a full KYC/sanctions program (see §14).

---

## 6. Rewards rail / giveaways / raids / bounties

### Takeaway
A full giveaway product is LIVE: creator-funded burner escrow (USDC, any SPL via Jupiter, or Megapot tickets), X-task auto-verification (follow / retweet / comment / exact-text post) via a third-party X API plus self-report/human review, eligibility filters, on-chain MagicBlock VRF draw (`loofta_vrf`), payout by claim link to each winner’s X identity. “Raids” are a creator template, not a separate product. No bounty module. No KYC backend despite a UI toggle.

### Cited Findings
- Lifecycle: `DRAFT → PENDING_APPROVAL → (REJECTED) → PENDING_FUNDING → FUNDED → OPEN → ENTRIES_CLOSED → DRAWING → WINNERS_SELECTED → PAYOUT_IN_PROGRESS → COMPLETED`, plus `CANCELLED / UNDERFUNDED_EXPIRED / REFUNDED`. Admin approval queue. Official Loofta giveaways (`is_official`) skip the fee and pin to the top. — [giveaway.entity.ts](apps/backend/src/modules/giveaways/entities/giveaway.entity.ts)
- Escrow: per-giveaway burner; fund via token transfer or MagicBlock private transfer; leftovers refunded minus platform fee. — [giveaway-funding.service.ts](apps/backend/src/modules/giveaways/giveaway-funding.service.ts)
- Reward types: `usdc`, `megapot_ticket`, arbitrary SPL `prize_mint`. — [giveaway.entity.ts](apps/backend/src/modules/giveaways/entities/giveaway.entity.ts)
- Tasks: `x_follow`, `x_retweet`, `x_comment`, `x_post` = AUTO_API; `x_like` downgraded to SELF_REPORT (X `liking_users` empty as of 2026-08-05); `x_bookmark`, `telegram_join`, `discord_join`, `visit_link`, `custom` = SELF_REPORT. — [giveaway.entity.ts](apps/backend/src/modules/giveaways/entities/giveaway.entity.ts), [x-verification.service.ts](apps/backend/src/modules/giveaways/x-verification.service.ts)
- Eligibility: min followers, min account age, verified-only, required/excluded countries & continents. Draw modes `random | first_come | manual`. VRF program id `5yv9aXx1vjRoCH1Ubxi7RNQggv9NHXxZC7zwUKLG4jYi`. — [giveaway-vrf.service.ts](apps/backend/src/modules/giveaways/giveaway-vrf.service.ts), `programs/loofta-vrf`
- Payout by handle: winners get `/c/[id]` claim links or gifted Megapot tickets. — [giveaway-payout.service.ts](apps/backend/src/modules/giveaways/giveaway-payout.service.ts)
- Rewards-rail UI (`/rewards-rail`): templates “Grow your X following”, “Boost a launch post”, “Grow your community”; **`kyc` toggle has no backend counterpart** (zero `kyc` matches in `giveaways/`). Pricing-plan / “recurring raid” / “$1 per KYC entrant” copy is UI-only. PARTIAL/STUB. — [specEngine.ts](apps/frontend/src/components/rewards-rail/specEngine.ts)
- Raids/bounties: no backend module. PARTIAL (copy/template only).
- **Sparks (LEGACY campaign, UI still live):** tasks connect email (250), connect X (250), first payment (500), pay unregistered (2000), payment-link paid (2000), ten payments (5000). `SPARKS_CUTOFF_ISO = 2026-07-01T16:00:00.000Z` — only payments before that date count; UI: “Sparks collection closed on July 1.” — [rewards.service.ts](apps/backend/src/modules/rewards/rewards.service.ts), [sparks/page.tsx](apps/frontend/src/app/app/sparks/page.tsx)
- Partner campaigns (windows past as of 2026-10-13 → LEGACY): Blink 2026-07-02–08-15; Megapot 5 tickets / $1000 pool to 2026-08-31; getpaid $50×3; MagicBlock quest push (IDs 43/44, weekly Friday 10:00 CET). — [REWARDS.md](docs/features/REWARDS.md)
- Volume-tier badges (Peon / Hustler / Whale / Mogul / Legend) are cosmetic. — [users.service.ts](apps/backend/src/modules/users/users.service.ts), [tiers.ts](apps/frontend/src/lib/tiers.ts)

### Inferences
- Giveaway stack (escrow + social verification + VRF + payout-to-handle) is the most complete B2B-adjacent product and the natural recombination for creator/KOL campaign payouts.

### Gaps
- No plan/subscription pricing. The `kyc` UI flag does nothing.

---

## 7. Megapot lottery and referral economics

### Takeaway
LIVE: private/public Megapot ticket purchases from Solana (burner → Base bridge → Rhinestone smart account → Megapot), Mystery Packs, ticket gifting (email / X / username, plus twitter-ticket-gifts), win resolution and withdraw, plus a subscription service not mentioned in LOTTERY.md. Buyer is not charged a Loofta ticket fee on the current purchase path; margin is Megapot’s ~10% referral share, claimed manually.

### Cited Findings
- Private purchase default (1–100 tickets); public 1–500. Draw cutoff 5 min before 7 PM CET. `initiatePurchase` returns `looftaFeeUsdc: 0`; bridge cost absorbed from fee-wallet. — [lottery.service.ts](apps/backend/src/modules/lottery/lottery.service.ts), [LOTTERY.md](docs/features/LOTTERY.md)
- Mystery Packs $2; enabled tiers 1/2/5/10 tickets (43% / 50% / 5.56% / 1.18%); 50/100 disabled; `crypto.randomInt`. Mobile: lottery built, packs **not** built. — [LOTTERY.md](docs/features/LOTTERY.md), [MOBILE.md](docs/features/MOBILE.md)
- Gifts: `sender_paid` and `admin_treasury`; claim by email/X/username. Frontend gift comment: “one signature, no separate fee.” Backend `confirmGiftFee` / `confirmFeeCollection` remain but have **no frontend callers**. — [lotteryGift.ts](apps/frontend/src/services/api/lotteryGift.ts)
- Megapot subscriptions: `megapot-subscription.service.ts` wired into lottery module, controller, admin, and cron; table `create_megapot_subscriptions.sql` — **not in LOTTERY.md**. Status: LIVE (backend) / undocumented.
- Referral: on-chain `getReferralFeesBalanceUsdc()`; admin deep-links Basescan `claimReferralFees()`; ledger table `megapot_referral_fee_claims`.
- `sendUnclaimedWinningsReminderEmail` has zero callers — STUB. Lottery crons are production-only.
- Mobile: Seeker-wallet-only lottery buy/redeem/gift-claim. — [MOBILE.md](docs/features/MOBILE.md)

---

## 8. Developer surface (API, keys, webhooks, SDK, agent skill, docs)

### Takeaway
LIVE: self-serve API keys (`lft_live_`, HMAC-peppered, scopes `payment_links:create` + `payouts:create`), `POST /payment-links` with signed webhooks, `POST /payouts` (single recipient; unsigned tx or cross-chain deposit address), docs site, agent skill. **SDK `payHuman()` is broken** — both `/integrators/v1/pay-human` and `/x402/pay-human` were deleted after the 2026-08-03 x402 drain (zero matches in `apps/backend/src/modules/integrators`). Payment-link SDK methods still match live endpoints.

### Cited Findings
- Keys: self-serve create/list/rotate/revoke; “at most one active key”; “no sandbox/test mode” (NEAR Intents is always mainnet; a test prefix would be misleading). Rate 30/min self-serve. — [integrators.service.ts](apps/backend/src/modules/integrators/integrators.service.ts), [skillContent.ts](apps/frontend/src/app/docs/skillContent.ts)
- Payouts: amount $0.01–$10,000, `is_private`, `sender_wallet` **or** `funding_source` + `refund_wallet`, 4 h expiry (or the deposit-address deadline, never less than 4 h). Loofta never signs. Rate 20/min. — [payouts.service.ts](apps/backend/src/modules/payouts/payouts.service.ts), [payouts.controller.ts](apps/backend/src/modules/payouts/payouts.controller.ts)
- Webhooks: payment-links `payment.succeeded` only. **No payout webhooks.**
- SDK `@loofta/pay-sdk`: `payHuman()` → deleted endpoints; `createPaymentLink` / `getPaymentLinkStatus` → live `/payment-links`. Default base `https://api.loofta.xyz`. Examples still demonstrate the dead x402 path (`examples/02-x402-signer.ts`). — [client.ts](apps/sdk/src/client.ts)
- Docs `/docs`: Introduction, Authentication, API key & branding, Code examples, Try it, Agent skill, Create a payment link, Checkout page, Pay a recipient, Whitelabel. — [docsNav.ts](apps/frontend/src/app/docs/docsNav.ts)
- Agent skill `LOOFTA_PAYMENT_LINKS_SKILL` documents payment links + `/payouts` incl. TON. In-app `/app/terminal` parses natural-language pay/gift commands.
- Twitter-payments: `POST /twitter-payments` integrator-backed.
- Organizations: single-owner profile (referral code, branding), reused for merchant branding — not multi-user teams. — [organizations.service.ts](apps/backend/src/modules/organizations/organizations.service.ts)

### Inferences
- x402 / “agents pay humans” is marketed in the SDK README and deleted in the backend. Re-shipping it safely (ATA sponsorship guards exist *because* of that drain) is a concrete product gap.

### Gaps
- Whether `@loofta/pay-sdk` is published on npm with the broken `payHuman` was not checked (no network lookup).

---

## 9. Identity / auth / KYC

### Takeaway
Identity = Privy (email, X, wallet, Seeker seed vault, Discord/GitHub OAuth) + `loo-` usernames or verified X handle + `social_accounts`. A handle is bound by Privy OAuth (or the Telegram relay / fomo.family’s own wallet link). There is **no Loofta-level KYC/KYB**. Only PAJ Cash runs KYC for Naira. Recipients can require private payments.

### Cited Findings
- Privy embedded Solana + EVM wallets (`createOnLogin: "users-without-wallets"`). — [USERS.md](docs/features/USERS.md), [AuthProvider.tsx](apps/frontend/src/providers/AuthProvider.tsx)
- Username: `loo-` prefix **or** must equal the caller’s Privy-verified X handle; `loo-skr-*` reserved for Seeker. Dropping the prefix is not implemented. — [USERS.md](docs/features/USERS.md)
- `verifyRecipientIdentityForSendPayment` checks `social_accounts` then live Privy OAuth for Discord/GitHub, not Telegram. — [users.service.ts](apps/backend/src/modules/users/users.service.ts)
- `POST /users/me/wallet/generate-new` always throws “not yet implemented” — STUB. `UsernameSetupModal` is likely dead (`showUsernameModal` never set true).
- KYC code exists only in paj-cash, plus leftover mentions in Li.Fi/Kalshi/Nest and the unused rewards-rail `kyc` toggle. None in claims / payouts / integrators.
- Admin: `ADMIN_PRIVY_USER_IDS` or `users.role = 'admin'`; analytics also gated by `[adminHash]` URL segment. — [ADMIN.md](docs/features/ADMIN.md)
- Mobile: Seeker-wallet-only (no email/OTP). — [MOBILE.md](docs/features/MOBILE.md)
- Turnstile: waitlist + guest send. — [ANTISPAM_TURNSTILE.md](docs/features/ANTISPAM_TURNSTILE.md), [claims.controller.ts](apps/backend/src/modules/claims/claims.controller.ts)

### Gaps
- No KYB of integrators. Anyone with a Privy login can mint a live mainnet API key.

---

## 10. Business features (bulk, scheduled, conditional, teams, invoices)

### Takeaway
Only partial: in-app multi-send (≤10), single-recipient payouts API, checkout links usable as one-shot invoices, MagicBlock delivery delay (not a payout scheduler). No batch API, no recurring/scheduled business payouts, no escrow-until-condition except giveaway tasks, no team accounts, no invoice object. Payroll tables were built and dropped.

### Cited Findings
- Multi-send max 10, min total $5. `/payouts` is “single-recipient only.” — [skillContent.ts](apps/frontend/src/app/docs/skillContent.ts)
- Payroll / deals tables dropped: [drop_payroll_tables.sql](apps/backend/supabase/migrations/20260423000000_drop_payroll_tables.sql), [drop_deals_and_payroll_tables.sql](apps/backend/supabase/migrations/20260423100000_drop_deals_and_payroll_tables.sql) — DEAD. Partners marketing page still lists “Scheduled payroll, recurring payments, and bulk contractor payouts.” — [PartnersContent.tsx](apps/frontend/src/app/partners/PartnersContent.tsx)
- “Scheduled” in code = MagicBlock private `maxDelayMs` / `private_transfer_delivery_schedule`, not cron payouts. — [privacyDelay.ts](apps/frontend/src/lib/privacyDelay.ts)
- Closest conditional release = giveaway task verification.
- Payment-link `message` example is “Invoice #1042”; no invoice entity. One link = one amount, not reusable. — [skillContent.ts](apps/frontend/src/app/docs/skillContent.ts)
- Organizations = single-owner branding, not roles/approvals.
- Demo store pages `app/app/demo-store`, `app/app/demo`.

---

## 11. Yield, Nest, and points

### Takeaway
Morpho/Kamino yield is **marketing-only**. FAQ copy speaks in the present tense (“Morpho Vault is the protocol powering yield”); HomeWhite says “coming soon.” Zero Morpho/Kamino integration code in `apps/backend` or `apps/frontend/src` except i18n/marketing. Nest (xStocks, pre-IPO, Kalshi, round-ups, streaks, flock) is a real module gated by `NEST_LIVE_TRADING`. Sparks are a closed campaign, not per-payment points.

### Cited Findings
- Morpho: [HomeWhiteContent.tsx](apps/frontend/src/app/home-white/HomeWhiteContent.tsx) L121/295/312 “coming soon”; [messages/en.json](apps/frontend/src/messages/en.json) L164–168 present-tense FAQ (also on SendPage). Kamino: **zero** matches in backend/frontend `src`. MARKETING-ONLY.
- “Every payment earns Loofta Points” copy ≠ Sparks (task-based, cutoff 2026-07-01).
- **Nest (GATED):** `xstocks`, `prestocks`, `kalshi`, `prediction-bets`, `nest-rebalance`, Elfa social signals, flock/kudos, round-ups, weekly streaks. `GET /nest/config` → `liveTrading: NEST_LIVE_TRADING === 'true'`. Crons prod-only. Not in `docs/features/`. — [nest/](apps/backend/src/modules/nest/), [nest.controller.ts](apps/backend/src/modules/nest/nest.controller.ts)

---

## 12. Admin, analytics, traction signals (what's tracked; DB not queried)

### Takeaway
A working admin analytics dashboard exists but is frontend-only. Many tables exist that *could* show traction; live counts were not queried.

### Cited Findings
- Analytics is **frontend-only** (no Nest analytics module): `GET api/admin/analytics` fans out ~16 Supabase queries — mainnet/devnet SUCCESS volume, all-status amounts, unique/repeat senders, signup→link→funded→claimed funnel, `app_users` counts, `mainnet_waitlist` (total / granted / with Twitter), lottery tickets, deposits, withdrawals. `.limit(100000)` then JS aggregation. Cached 60s. Also `api/dune/stats`. — [ADMIN.md](docs/features/ADMIN.md), [analytics/route.ts](apps/frontend/src/app/api/admin/analytics/route.ts)
- Admin tabs: Analytics, Lottery, Packs, Payments, Cashout, Sparks, Waitlist, Blink, Giveaways, Outreach.
- Traction-relevant tables (schema only): `payments` (`fee_paid_usdc`, `is_private`, `is_multi_send`, `recipient_was_unregistered`, guest sender), `app_users.total_volume_usd`, `mainnet_waitlist`, `lottery_tickets`, `pack_openings`, `giveaways`/entries, `withdrawals`, `user_deposits`, `offramp_requests`, `paj_cash_orders`, `private_transfers`, `integrators`/`integrator_api_keys`, `twitter_payment_requests`, `megapot_referral_fee_claims`, `ata_sponsorships`, `nest_*`, `outreach_prospects`.
- AI outreach dashboard (X/DefiLlama discover → AI draft → bulk DM) is frontend-only. Email broadcast + marketing unsubscribe exist. No unified fee ledger.

### Gaps
- Live counts were deliberately not queried.

---

## 13. Solana-specific primitives

### Cited Findings
- **SolanaSponsorService** fee payer (`SOLANA_FEE_PAYER_PRIVATE_KEY`) co-signs/sponsors; its USDC ATA is also the fee-collection account and pack treasury. — [solana-sponsor.service.ts](apps/backend/src/modules/claims/solana-sponsor.service.ts)
- ATA sponsorship guard + `ata_sponsorships` table (built after the 2026-08-03 x402 drain). `ata-rent-recovery.ts`, `burner-reclaim.ts`. — [ata-sponsorship-guard.ts](apps/backend/src/common/ata-sponsorship-guard.ts)
- Burner rent reclaim cron (mainnet, batches of 10).
- **Burner key encryption:** AES-256-GCM, v2 per-payment HKDF (context = burner pubkey), `SEND_PAYMENT_ENC_KEY` / `_OLD`, GCP KMS wrapping fails closed in production (`SOLANA_FEE_PAYER_PRIVATE_KEY` + enc keys). — [encryption.service.ts](apps/backend/src/modules/send-payment/encryption.service.ts), [kms-secrets.ts](apps/backend/src/common/kms-secrets.ts)
- MagicBlock Ephemeral Rollup ATA undelegation / Jun-26 wallet migration. Two cutoff dates float (`2026-06-26` hook vs `2026-06-28` backend). — [USERS.md](docs/features/USERS.md)
- Own Anchor program `loofta_vrf` for giveaway draws.
- Many crons (claims, sweeps, tx verifier, private balance, PAJ 20s, deposits, lottery 5s) without a distributed lock — re-entrancy booleans only. — [PAYMENTS.md](docs/features/PAYMENTS.md)
- Recurring idiom: client-side poll drives happy path; server cron reconciles abandoned tabs.

---

## 14. Missing for a B2B payout product

### Takeaway
The rails (pay-to-identity, registered-direct, burner escrow, claim, cash-out, API keys, payment-link webhooks) exist. The compliance and ops layer a B2B buyer expects is almost entirely absent. Several B2B surfaces were built and then dropped (payroll tables) or are marketing-only (partners page payroll copy, Morpho yield, card).

### Cited Findings (absence verified by search over `apps/backend/src` and `apps/frontend/src`)
- **KYC/KYB of payers or recipients:** none outside PAJ Cash and an unimplemented rewards-rail `kyc` toggle.
- **Tax forms (1099 / W-8BEN / W-9):** zero matches.
- **Sanctions/OFAC program:** legal copy in terms/privacy; only Range address-risk on some withdraw/claim paths. No OFAC list screening of emails/handles/names, no travel-rule, no geo-block beyond giveaway country filters and terms language.
- **Batch payout API:** absent (“single-recipient only”). In-app multi-send max 10 is not an API.
- **Payout webhooks / status callbacks:** absent.
- **Sandbox/test mode:** absent, despite a conceptual test key prefix.
- **Refunds:** sender reclaim of *unclaimed* payments, expiry, lottery/giveaway auto-refunds. No merchant-initiated refund API for a paid payment link.
- **Reconciliation / reporting exports / unified ledger:** absent.
- **Multi-user team accounts, roles, approvals:** absent (one key per integrator, single owner).
- **Prefunded balance payouts via API:** `/payouts` requires the caller to sign from their wallet or deposit cross-chain each time. No merchant float.
- **Scheduled/recurring payouts, invoice object, multi-currency fiat beyond USD/NGN:** absent.
- **Payroll:** tables dropped.

### Inferences
- Shortest path to a B2B payout product: batch wrapper over existing `ClaimsService.createFrom*` + payout webhooks + sandbox + a ledger table + sanctions screening (Range is already wired for addresses).
- Giveaways + payouts API is the natural recombination for creator/community/KOL payouts (verified-task-gated escrow already ships).
- Registered-direct pay is a better primitive for “pay my existing users”; burner-claim remains the “pay someone who isn’t on the platform yet” asset — that second one is the rare capability vs Stripe/PayPal.

### Gaps
- Production env flag values (private payments, Telegram, cross-chain, Nest live trading) are unknowable from the repo; GATED items may be on or off in prod.
- Live traction numbers were not queried.
- Whether the $0.10 unregistered fee is actually collected on-chain if a client omits it.
- Whether `@loofta/pay-sdk` is published on npm with the broken `payHuman`.
