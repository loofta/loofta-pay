# Loofta Pay

**Multi-chain crypto payments made simple and private.**

Loofta Pay is a non-custodial payment platform that lets you create payment links and receive crypto in any token you choose — regardless of what chain or token your payer uses. Pay privately with **Privacy Cash** (USDC on Solana), and withdraw only to AML-compliant addresses via **Range**.

## Features

- **Payment links** — Create a claim, share the link (`/c/[id]`). Payers send any supported token; you receive the token and chain you configured.
- **Multi-chain** — Accept payments from 20+ blockchains: Ethereum, Arbitrum, Base, Polygon, Solana, Bitcoin, TON, Zcash, and more.
- **Privacy Cash (USDC on Solana)** — Pay or receive privately using [Privacy Cash](https://privacy.cash/). Private payments settle in USDC on Solana via zero-knowledge privacy; payers can use Phantom to complete the transfer.
- **Private withdrawals** — Withdraw your embedded-wallet balance privately via Privacy Cash. Destination addresses are checked with **Range** for AML compliance; withdrawal is only allowed to compliant addresses.
- **Cross-chain routing** — NEAR Intents routes cross-chain payments; same-chain swaps use Biconomy or Rhinestone.
- **Embedded wallet** — Privy-powered embedded Solana wallet for receiving and withdrawing USDC; no separate wallet required for basic flows.
- **Optional private-only claims** — Creators can require private payments only on a payment link.

## Tech Stack

- **Frontend**: [Next.js 16](https://nextjs.org/) (App Router), TypeScript, Tailwind CSS, Framer Motion, [Privy](https://privy.io/)
- **Backend**: [NestJS](https://nestjs.com/), Supabase (Postgres), Redis (locks)
- **Payments & privacy**: [Privacy Cash](https://privacy.cash/) (USDC on Solana), [NEAR Intents](https://near.org/), [Biconomy](https://biconomy.io/), [Rhinestone](https://rhinestone.dev/)
- **Compliance**: [Range](https://range.org/) (address risk / AML check for withdrawals)

## Project structure

Monorepo (npm workspaces):

```
apps/
├── frontend/     # Next.js app (payment links, claim, withdraw, swap)
│   └── src/
│       ├── app/
│       │   ├── c/[id]/     # Payment link page (pay with any token or Privacy Cash)
│       │   ├── claim/      # Create payment request
│       │   ├── link/       # Username-based payment link
│       │   ├── api/
│       │   │   ├── claims/ # Claim CRUD, deposit, quote
│       │   │   ├── risk/   # Range address check (AML)
│       │   │   └── ...
│       │   └── ...
│       ├── components/     # BalanceModal (withdraw + Range), Header, ...
│       └── services/       # privacyCash, nearIntents, solanaBalance, ...
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

# Solana (Privacy Cash, withdraw)
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
# Or: NEXT_PUBLIC_HELIUS_API_KEY=your_helius_key

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
| `contracts/payroll-attestation/deploy.sh` | Build NEAR attestation WASM; use `deploy` arg to deploy to mainnet (see [NEAR attestation](#near-attestation-on-chain-payment-proof)) |

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

## NEAR attestation (on-chain payment proof)

Completed claim payments can be recorded on NEAR for hackathon/audit: one on-chain record per claim (claim id, amount, token, execution ref). Optional; if not configured, the app works without it.

- **Contract**: `contracts/payroll-attestation` (payroll attestation, Rust, `record_payment` / `get_payment`).
- **Cost**: Very low (a few NEAR one-time; storage ~0.0001 NEAR/byte).
- **Deploy**: See [contracts/payroll-attestation/README.md](contracts/payroll-attestation/README.md). Quick path:
  ```bash
  cd contracts/payroll-attestation
  chmod +x deploy.sh
  ./deploy.sh                    # build only
  CONTRACT_ACCOUNT=attestation.yourname.near INIT_CALLER=your-backend.near ./deploy.sh deploy
  ```
- **Backend env**: `NEAR_ATTESTATION_CONTRACT_ID`, `NEAR_ATTESTATION_NEAR_ACCOUNT_ID`, `NEAR_ATTESTATION_NEAR_PRIVATE_KEY`, `NEAR_NETWORK_ID=mainnet` (see `apps/backend/env.template`). When set, the backend calls the contract after each successful claim payment and stores the NEAR tx hash on the claim; the claim page shows “Attested on NEAR” with a link when present.

## Privacy Cash & withdraw flow

1. **Pay privately (claim page)**  
   Payer selects “Pay USDC on Solana”; cross-chain funds land in their Phantom (or configured) Solana wallet, then they complete the private transfer via Privacy Cash (Phantom signs).

2. **Withdraw balance**  
   User opens Balance from the header → Withdraw. They enter amount and destination Solana address. The app checks the address with **Range** (AML); only when the address is compliant does “Withdraw” enable. Withdrawal is executed via Privacy Cash (private).

3. **Range**  
   Destination addresses are verified server-side (`/api/risk/address`) using Range; keys stay on the server. See `apps/frontend/src/app/api/risk/address/route.ts`.

## Supported chains

Ethereum, Arbitrum, Base, Polygon, BNB Chain, Solana, Bitcoin, Zcash, TON, Cardano, XRP, Dogecoin, Litecoin, Stellar, Tron, SUI, Aurora, Gnosis, and others via NEAR Intents and provider configs.

## Links

- **Website**: [loofta.xyz](https://pay.loofta.xyz)
- **Twitter**: [@looftapay](https://x.com/looftapay)
- **Telegram**: [t.me/looftaxyz](https://t.me/looftaxyz)
- **Privacy Cash**: [privacy.cash](https://privacy.cash/)
- **Range**: [range.org](https://range.org/)

## License

Private — All rights reserved.
