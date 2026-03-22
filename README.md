# Loofta Pay

**Multi-chain crypto payments made simple and private.**

Loofta Pay is a non-custodial payment platform that lets you create payment links and receive crypto in any token you choose — regardless of what chain or token your payer uses. Pay privately with **MagicBlock PER** (private USDC settlement on Solana), and withdraw only to AML-compliant addresses via **Range**.

## Features

- **Payment links** — Create a claim, share the link (`/c/[id]`). Payers send any supported token; you receive the token and chain you configured.
- **Multi-chain** — Accept payments from 20+ blockchains: Ethereum, Arbitrum, Base, Polygon, Solana, Bitcoin, TON, Zcash, and more.
- **Private payments (USDC on Solana)** — Pay or receive using **MagicBlock Private Ephemeral Rollup (PER)**. Settlement uses the in-repo Anchor program (`programs/loofta-per-payments`); payers typically use Phantom or your embedded wallet to sign.
- **Private withdrawals** — Withdraw your embedded-wallet balance through the app’s private path. Destination addresses are checked with **Range** for AML compliance; withdrawal is only allowed to compliant addresses.
- **Cross-chain routing** — NEAR Intents routes cross-chain payments; same-chain swaps use Biconomy or Rhinestone.
- **Embedded wallet** — Privy-powered embedded Solana wallet for receiving and withdrawing USDC; no separate wallet required for basic flows.
- **Optional private-only claims** — Creators can require private payments only on a payment link.

## Tech Stack

- **Frontend**: [Next.js 16](https://nextjs.org/) (App Router), TypeScript, Tailwind CSS, Framer Motion, [Privy](https://privy.io/)
- **Backend**: [NestJS](https://nestjs.com/), Supabase (Postgres), Redis (locks)
- **Payments & privacy**: MagicBlock PER (see `programs/loofta-per-payments`), [NEAR Intents](https://near.org/), [Biconomy](https://biconomy.io/), [Rhinestone](https://rhinestone.dev/)
- **Compliance**: [Range](https://range.org/) (address risk / AML check for withdrawals)

## Project structure

Monorepo (npm workspaces):

```
apps/
├── frontend/     # Next.js app (payment links, claim, withdraw, swap)
│   └── src/
│       ├── app/
│       │   ├── c/[id]/     # Payment link page (any token or private USDC / PER)
│       │   ├── claim/      # Create payment request
│       │   ├── link/       # Username-based payment link
│       │   ├── api/
│       │   │   ├── claims/ # Claim CRUD, deposit, quote
│       │   │   ├── risk/   # Range address check (AML)
│       │   │   └── ...
│       │   └── ...
│       ├── components/     # BalanceModal (withdraw + Range), Header, ...
│       └── services/       # privatePayment, nearIntents, solanaBalance, ...
└── backend/      # NestJS API (claims, deposit, cron, migrations)
    └── src/
        ├── modules/claims/
        ├── modules/cron/
        └── ...
```

## Getting started

### Prerequisites

- Node.js 18+
- npm (or pnpm / yarn)

### Installation

```bash
# Clone the repository
git clone https://github.com/lisabeyy/loofta-swap.git
cd loofta-swap

# Install dependencies (root + workspaces)
npm install

# Start frontend dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For full flow (deposits, cron), run the backend as well:

```bash
npm run dev:backend
```

### Environment variables

**Frontend** (`apps/frontend/.env.local`):

```env
# Supabase (auth, optional server-side)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SECRET_KEY=your_supabase_service_role_key

# Privy (auth + embedded Solana wallet)
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id

# Solana (PER, withdraw)
# NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
# Or: NEXT_PUBLIC_HELIUS_API_KEY=your_helius_key
# NEXT_PUBLIC_PER_PROGRAM_ID=...
# NEXT_PUBLIC_MAGICBLOCK_URL=https://tee.magicblock.app

# Range (AML check for withdrawals – server-side proxy)
# Add RANGE_API_KEY in backend; frontend calls /api/risk/address

# Backend URL (for deposit, claims)
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001

# Swap / intents
NEXT_PUBLIC_ONECLICK_JWT=your_oneclick_jwt
```

**Backend** (`apps/backend/.env.local`):

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SECRET=your_supabase_service_role_key
RANGE_API_KEY=your_range_api_key   # For /api/risk/address proxy
# See apps/backend/env.template for full list
```

See `apps/backend/supabase/REMOTE_DEV.md` for using a remote Supabase project instead of local Docker.

### MagicBlock PER (private USDC send links, devnet)

Send-payment “Pay privately” uses the **MagicBlock Private Ephemeral Rollup** client and the Anchor program in `programs/loofta-per-payments/`.

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_SOLANA_CLUSTER` | Frontend | Set to `devnet` for this branch; drives RPC, USDC mint, and UI (e.g. Devnet badge). |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Frontend | Devnet RPC (Helius devnet or `https://api.devnet.solana.com`). |
| `NEXT_PUBLIC_SOLANA_WS_URL` | Frontend | Optional devnet WebSocket (matches RPC). |
| `NEXT_PUBLIC_PER_PROGRAM_ID` | Frontend | Deployed Anchor program id (matches `programs/loofta-per-payments`). |
| `NEXT_PUBLIC_MAGICBLOCK_URL` | Frontend | TEE HTTP endpoint (default `https://tee.magicblock.app`). |
| `NEXT_PUBLIC_MAGICBLOCK_VALIDATOR` | Frontend | Optional; validator pubkey from MagicBlock docs if the default changes. |
| `NEXT_PUBLIC_SOLANA_USDC_MINT` | Frontend | Override USDC mint; default devnet mint is `4zMMC9…` in `getUsdcMint()`. |
| `NEXT_PUBLIC_ENABLE_PRIVATE_PAYMENT` | Frontend | If `true` or `1`, enables MagicBlock PER private flow, defaults all payment links to private, hides the private toggle, and USDC-only pay on claim (replaces legacy `NEXT_PUBLIC_PER_MODE` for that UX). |
| `SOLANA_USDC_MINT` | Backend | Must match cluster (devnet USDC mint for devnet). |
| `SOLANA_RPC_URL` | Backend | Devnet RPC for server-built txs / verification. |
| `SOLANA_FEE_PAYER_PRIVATE_KEY` | Backend | Fee payer; **fund with devnet SOL** (e.g. [faucet](https://faucet.solana.com/)) for sponsored claim/recipient ATA creation. |

**Privy:** In [dashboard.privy.io](https://dashboard.privy.io), enable **Solana devnet** for embedded wallets if you use devnet.

**Logging:** PER errors on the client use `logPerError` in `apps/frontend/src/lib/per/log.ts` (cluster, program id, user pubkey, step — **no** TEE session tokens). Backend send-payment uses Nest `Logger` with correlation IDs; do not log TEE tokens or raw session material.

**Recipients / claim:** `/send` accepts `email`, `twitter`, or `username` (Loofta username). The backend resolves a **recipient Solana pubkey** at link creation. For **private** sends, the sender completes a PER transfer to that pubkey’s deposit flow; the recipient must log in with the matching identity and claim **after** the link is `FUNDED` (see `send-payment` service).

**Anchor:** Build with `anchor build`; deploy with a devnet-funded wallet. If `cargo-build-sbf` fails on `blake3` edition, pin `blake3` to `1.8.2` in the workspace `Cargo.lock` (see project history).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend (Next.js) |
| `npm run dev:backend` | Start backend (NestJS) |
| `npm run dev:all` | Frontend + backend |
| `npm run build` | Build frontend |
| `npm run build:all` | Build all workspaces |
| `npm run start` | Start frontend (production) |
| `npm run lint` | Lint all workspaces |
| `npm run test` | Run backend tests |

**Database (backend):**

- `npm run db:start --workspace=@loofta/backend` — Start local Supabase (Docker)
- `npm run db:migrate:local` — Reset local DB and apply migrations
- `npm run db:migrate:prod` — Push migrations to linked remote project (see `apps/backend/supabase/REMOTE_DEV.md`)

## Deployment

Deploys run from the **`main`** branch via GitHub Actions.

| App      | Platform | Behavior |
|----------|----------|----------|
| Backend  | Railway  | **Action** `.github/workflows/deploy-backend.yml` runs on push to `main` when `apps/backend/**` or root package files change. Add repo secret **`RAILWAY_TOKEN`** (Railway → Project → Settings → Tokens). Optional **`RAILWAY_SERVICE_ID`** if the project has multiple services. |
| Frontend | Vercel   | Auto-deploys on push to `main`. |
| DB       | GitHub Actions | Migrations when `apps/backend/supabase/migrations/**` change on `main` (`.github/workflows/deploy-migrations.yml`). |

## Private pay & withdraw flow

1. **Pay privately (claim page)**  
   Payer selects private USDC on Solana where applicable; cross-chain funds land in their wallet, then they complete the **MagicBlock PER** transfer (Phantom or embedded wallet signs).

2. **Withdraw balance**  
   User opens Balance from the header → Withdraw. They enter amount and destination Solana address. The app checks the address with **Range** (AML); only when the address is compliant does “Withdraw” enable.

3. **Range**  
   Destination addresses are verified server-side (`/api/risk/address`) using Range; keys stay on the server. See `apps/frontend/src/app/api/risk/address/route.ts`.

## Supported chains

Ethereum, Arbitrum, Base, Polygon, BNB Chain, Solana, Bitcoin, Zcash, TON, Cardano, XRP, Dogecoin, Litecoin, Stellar, Tron, SUI, Aurora, Gnosis, and others via NEAR Intents and provider configs.

## Links

- **Website**: [loofta.xyz](https://pay.loofta.xyz)
- **Twitter**: [@looftapay](https://x.com/looftapay)
- **Telegram**: [t.me/looftaxyz](https://t.me/looftaxyz)
- **MagicBlock**: [magicblock.gg](https://www.magicblock.gg/)
- **Range**: [range.org](https://range.org/)

## License

Private — All rights reserved.
