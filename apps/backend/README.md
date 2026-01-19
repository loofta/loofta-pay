# Loofta Swap Backend

NestJS backend API for Loofta Swap - Cross-chain payment infrastructure.

## Features

- **Organizations**: CRUD operations for managing payment organizations
- **Claims**: Payment claim creation and deposit handling
- **Intents**: Cross-chain swap orchestration (Near Intents, Rhinestone)
- **Tokens**: Token listing and price information
- **Lottery**: Ticket purchase encoding for lottery contracts
- **Cron**: Automated claim processing

## Getting Started

### Prerequisites

- Node.js 20+
- npm or yarn
- Redis (optional, for distributed locking)

### Installation

```bash
# From project root
cd apps/backend
npm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
# Server
PORT=3001
NODE_ENV=development

# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET=your-service-role-key

# Redis (optional)
REDIS_URL=redis://localhost:6379

# Near Intents
ONECLICK_API_BASE=https://1click.chaindefuser.com
ONECLICK_JWT=your-jwt-token
ONECLICK_REFERRAL=loofta

# Rhinestone
RHINESTONE_API_KEY=your-api-key


# Admin
ADMIN_PRIVY_USER_IDS=did:privy:xxx

# CORS
CORS_ORIGIN=http://localhost:3000
```

### Running

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

### Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

## API Documentation

Swagger documentation is available at `/api/docs` when the server is running.

## API Endpoints

### Health
- `GET /` - API info
- `GET /health` - Health status
- `GET /healthz` - Liveness probe
- `GET /ready` - Readiness probe

### Organizations (Admin)
- `GET /organizations` - List all
- `GET /organizations/:id` - Get by ID
- `GET /organizations/public/by-referral?code=xxx` - Public info
- `POST /organizations` - Create
- `PUT /organizations` - Update
- `DELETE /organizations?id=xxx` - Delete

### Claims
- `POST /claims/create` - Create claim
- `GET /claims/:id` - Get claim
- `GET /claims/:id/latest-intent` - Get with intent
- `POST /claims/deposit` - Request deposit address

### Tokens
- `GET /tokens` - List all
- `GET /tokens/search?q=xxx` - Search
- `GET /tokens/by-chain?chain=xxx` - By chain
- `GET /tokens/popular` - Popular tokens
- `GET /tokens/stablecoins` - Stablecoins
- `GET /tokens/price?symbol=xxx&chain=xxx` - Get price

### Intents
- `POST /intents/quote` - Get swap quote
- `GET /intents/status` - Get transaction status
- `GET /intents/rhinestone/eligibility` - Check Rhinestone
- `GET /intents/rhinestone/chains` - Supported chains

### Lottery
- `GET /lottery/contract` - Contract info
- `POST /lottery/encode` - Encode purchase
- `GET /lottery/estimate?ethAmount=xxx` - Estimate tickets
- `GET /lottery/calculate-eth?tickets=xxx` - Calculate ETH

### Cron
- `GET /cron/status` - Processing status
- `GET /cron/process-claims` - Trigger processing

## Architecture

```
src/
├── main.ts                 # Application entry point
├── app.module.ts           # Root module
├── database/               # Supabase integration
├── redis/                  # Redis service
├── common/
│   └── guards/             # Auth guards
└── modules/
    ├── organizations/      # Organization CRUD
    ├── claims/             # Claims & deposits
    ├── intents/            # Cross-chain intents
    ├── tokens/             # Token information
    ├── lottery/            # Lottery encoding
    ├── cron/               # Background jobs
    └── health/             # Health checks
```

## Security

- Admin routes protected by `AdminGuard`
- User routes protected by `AuthGuard`
- Cron routes protected by `CronGuard`
- Rate limiting via `@nestjs/throttler`
- Input validation via `class-validator`

## License

UNLICENSED - Private repository
