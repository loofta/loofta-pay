# Loofta Pay

**Multi-chain crypto payments made simple and private.**

Loofta is a non-custodial payment platform that lets you create payment requests and receive crypto in any token you choose — regardless of what chain or token your payer uses.

## Features

- **Multi-chain Support** — Accept payments from 20+ blockchains: Ethereum, Arbitrum, Base, Polygon, Solana, Bitcoin, TON, Zcash, and more
- **Token Flexibility** — Your payer sends whatever they have. You receive exactly what you configured
- **Privacy Options** — Settle in Zcash using shielded addresses for private payments
- **No Wallet Required** — Cross-chain payments work via deposit addresses, no wallet connection needed
- **Near-Zero Fees** — Cross-chain fees as low as 0.0001%

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Data Fetching**: TanStack Query
- **Authentication**: [Privy](https://privy.io/)
- **Database**: Supabase
- **Animations**: Framer Motion, Lottie, Spline 3D

### Swap Providers

- **[NEAR Intents](https://near.org/)** — Cross-chain swaps and routing
- **[Biconomy](https://biconomy.io/)** — Same-chain bundled transactions
- **[Rhinestone](https://rhinestone.dev/)** — Smart account modules

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/lisabeyy/loofta-pay.git
cd loofta-pay

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SECRET=your_supabase_secret_key

# Privy (Authentication)
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id

# Swap Providers
BICONOMY_API_KEY=your_biconomy_api_key
RHINESTONE_API_KEY=your_rhinestone_api_key

# NEAR Intents / One-Click
NEXT_PUBLIC_ONECLICK_JWT=your_oneclick_jwt

# Analytics (optional)
DUNE_API_KEY=your_dune_api_key
```

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   │   ├── claims/        # Payment claim endpoints
│   │   ├── near-intents/  # NEAR Intents integration
│   │   └── status/        # Transaction status
│   ├── c/[id]/           # Payment link page
│   ├── claim/            # Create payment request
│   └── swap/             # Direct swap interface
├── components/            # React components
│   ├── layout/           # Header, Footer, AppShell
│   ├── swap/             # Swap-specific components
│   └── ui/               # Reusable UI primitives
├── config/               # Configuration files
│   ├── swapProvider.ts   # Active provider settings
│   └── tokenlist/        # Supported tokens
├── hooks/                # Custom React hooks
├── lib/                  # Utility functions
├── providers/            # React context providers
├── services/             # External service integrations
│   ├── biconomy.ts
│   ├── nearIntents.ts
│   └── rhinestone.ts
├── store/                # Zustand state stores
└── types/                # TypeScript type definitions
```

## Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Supported Chains

| Chain | Status |
|-------|--------|
| Ethereum | ✅ |
| Arbitrum | ✅ |
| Base | ✅ |
| Polygon | ✅ |
| BNB Chain | ✅ |
| Solana | ✅ |
| Bitcoin | ✅ |
| Zcash | ✅ |
| TON | ✅ |
| Cardano | ✅ |
| XRP | ✅ |
| Dogecoin | ✅ |
| Litecoin | ✅ |
| Stellar | ✅ |
| Tron | ✅ |
| SUI | ✅ |
| Aurora | ✅ |
| Gnosis | ✅ |
| Monad | ✅ |
| XLayer | ✅ |

## Links

- **Website**: [loofta.com](https://loofta.xyz)
- **Twitter**: [@loofta](https://x.com/lisabeyy)
- **Telegram**: [t.me/loofta](https://t.me/looftaxyz)


## License

Private — All rights reserved.
