# Loofta Pay — Feature Documentation

Full feature map of the loofta-swap monorepo, written for a new engineer joining the project.
Each doc is grounded in the current code (file paths, function names, DB tables) rather than
intent — where something is planned-but-not-built or currently broken/disabled, it's called
out explicitly as a gotcha.

## Domains

- **[Payments](PAYMENTS.md)** — public/private payments, claims (vs. legacy `claims` table),
  claim to bank (PAJ Cash/Naira), short & share URLs, minimum amount, burner wallets & DB
  encryption, recipient edit, multi-send, toast notifications, privacy fees, cron.
- **[Users](USERS.md)** — onboarding, embedded wallet, mainnet-private cluster upgrade, the
  `loo-` username prefix (and the not-yet-built plan to drop it), social links, the Telegram/
  loofta.com relay, deposit (Blink/Coinbase/NEAR/PAJ Cash), withdraw (private/regular/NEAR/PAJ
  Cash).
- **[Lottery](LOTTERY.md)** — private/public ticket purchase, the Relay-vs-Li.Fi bridge (with
  the actual env-var behavior verified), cron, redeem win (+ the unwired "unclaimed winnings"
  email), Megapot API integration, Mystery Packs (odds & admin controls), gifting.
- **[Admin](ADMIN.md)** — analytics dashboard, outreach/campaign tooling, and fee earning
  (privacy fees, cross-chain fees, Megapot referral fees) — including why there's currently no
  fee-consolidation service.
- **[Mobile app](MOBILE.md)** — lottery (built), Mystery Packs (not built on mobile), and the
  Seeker-wallet-only login model.
- **[Rewards](REWARDS.md)** — Blink campaign, Megapot campaign, and the MagicBlock quests push
  API (including the 2026-07-30 `is_private` race-condition fix).

## Reading this if you're new

The single idiom that recurs across almost every money-moving feature: **a client-side poll
drives normal-case progress, and a server cron reconciles anything the client never got to
report** (deposits, withdrawals, offramp, private transfers, lottery bridges all follow this
pattern independently). If you're debugging a "stuck" state anywhere in the app, the relevant
cron service in that feature's module is almost always where to look first.

The second recurring theme: money-moving flows in this codebase go through a **one-time burner
wallet**, not a direct wallet-to-wallet transfer — true for payments, lottery ticket purchases,
and Mystery Pack fulfillment alike. If you're adding a new payout destination, read the
`solana-sponsor-safety` skill before touching it.
