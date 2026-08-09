# Gacha Pack Party

Gacha is a devnet-only pooled CollectorCrypt pack game. Authenticated users pay the configured
USDC-Dev entry, the treasury purchases and opens one real devnet pack, MagicBlock VRF excludes
players, survivors vote on further cuts, and the final survivors split the verified buyback
proceeds.

The frontend entry route is `/app/gacha`; the guided join flow is `/app/gacha/play`; a room is
`/app/gacha/:roomId`. The frontend proxies REST calls through `/api/gacha/*` to the Nest backend.
When the ER subscription flag is enabled, ready/vote reads come directly from the delegated room
PDA; Socket.IO remains the fallback and carries database-only lifecycle/mascot/exclusion events.

## Network and deployed programs

Everything in this module is explicitly Solana devnet, independent of the app-wide mainnet
settings.

- Gacha USDC-Dev mint: `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` (6 decimals)
- Gacha room-state program: `9TebHwRo3q3mhncqKpuBvACdiwPthR2JfyBrwJW6a8Lt`
- Loofta VRF program: `5yv9aXx1vjRoCH1Ubxi7RNQggv9NHXxZC7zwUKLG4jYi`
- MagicBlock base RPC: `https://rpc.magicblock.app/devnet`
- MagicBlock router: `https://devnet-router.magicblock.app/`
- CollectorCrypt API: `https://dev-gacha.collectorcrypt.com`

Both program IDs were verified executable on devnet on 2026-08-09. The room-state program and
its initializer are controlled by the existing backend fee-payer public key
`5dCTWJj277c41ex92RFxSRUa8ckU4EAurWftDRASBKuq`. A newly generated wallet cannot enable the
on-chain ready/vote flags without deploying a new program configured for that new authority.

## State machine

```text
waiting
  -> purchasing
  -> opening
  -> excluding       (initial MagicBlock VRF draw)
  -> voting          (zero or more vote + VRF cut rounds)
  -> settling        (CollectorCrypt buyback is in flight)
  -> settled         (survivor payouts are computed and individually claimable)

Any unrecoverable purchase/open/buyback inconsistency -> failed
```

The older `bidding` code and columns remain for backward compatibility, but the current Pack
Party flow never transitions into bidding.

The ready check only synchronizes the frontend reveal animation. It does not control payment,
pack purchase, VRF, settlement, or claims.

## Required local configuration

Create `apps/backend/.env.local` locally. Never commit it.

```dotenv
NODE_ENV=development
PORT=3001
CORS_ORIGIN=http://localhost:3000

PRIVY_APP_ID=<app-id>
PRIVY_APP_SECRET=<rotated-server-secret>
SUPABASE_URL=<project-url>
SUPABASE_SECRET=<service-role-key>

SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com
SOLANA_USDC_MINT_DEVNET=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
SOLANA_FEE_PAYER_PRIVATE_KEY=<base58-secret-for-5dCTW...BKuq>

COLLECTORCRYPT_ENV=devnet
MAGICBLOCK_BASE_RPC_URL=https://rpc.magicblock.app/devnet
MAGICBLOCK_ROUTER_URL=https://devnet-router.magicblock.app/

# Local-only convenience. Keep false/unset on shared or production deployments.
GACHA_DEVNET_AUTO_FUND=true

# Enable only with the existing authorized fee-payer key and after applying all migrations.
GACHA_ONCHAIN_READY_STATE=false
GACHA_ONCHAIN_VOTE_STATE=false
GACHA_ONCHAIN_LIFECYCLE_STATE=false
```

Create `apps/frontend/.env.local` locally:

```dotenv
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_PRIVY_APP_ID=<app-id>
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SHOW_GACHA_DEV_TOOLS=true
NEXT_PUBLIC_GACHA_ER_SUBSCRIPTION=true
NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL=https://devnet-router.magicblock.app
```

The browser derives `sha256(roomId)` and the `gacha-room` PDA, asks Magic Router which validator
currently owns the delegated account, then subscribes directly to that ER endpoint with Solana
`onAccountChange`. The initial account fetch and subsequent updates use the same ER connection.
If the PDA is not delegated yet or the router/ER is temporarily unavailable, the hook retries and
the existing Socket.IO/REST paths continue to keep the room usable.

The Privy secret previously pasted into chat must be revoked/rotated. Only the replacement secret
should be entered directly into the ignored backend env file or the team's secret manager.

## Database

Apply all migrations through `20260809120000_harden_gacha_invariants.sql`. The hardening
migration adds:

- atomic payout-claim locks;
- idempotent failed-join refund records;
- room/config bounds required by the exclusion game and u16 on-chain masks;
- unique room seat numbers and bid payment hashes;
- immutable locked mascots.

All Gacha tables use RLS and are accessible only through the service-role backend.

## Run and verify

```bash
npm ci
npm run dev:backend
npm run dev
```

Useful checks:

```bash
npm run build:backend
npm run build
npm test --workspace=@loofta/backend -- --runInBand src/modules/gacha/gacha-payout.spec.ts
cargo test -p gacha-room-state
```

The backend cron advances VRF/voting/settlement only when `NODE_ENV=production`, preventing a
local process from racing the shared deployment. Local dev tools expose authenticated,
non-production-only force-advance endpoints.

## Security and correctness invariants

- The backend derives the Solana wallet from the authenticated Privy user; join callers cannot
  nominate an arbitrary wallet for treasury auto-funding.
- Every entry payment is verified on-chain for devnet mint, treasury credit, sender, exact memo,
  success, and replay protection.
- The waiting-to-purchasing update is a conditional atomic claim, so the last-seat race cannot
  buy two packs.
- A valid payment that loses the final-seat race is refunded exactly once using its transaction
  hash as the idempotency key.
- VRF never silently falls back to `Math.random`; stalled oracle requests remain visible and
  require retry/ops attention.
- Payout allocation uses integer base units and preserves all dust deterministically.
- A durable per-participant claim token prevents concurrent payout requests from double-sending.
- Treasury transfers are confirmed and checked for on-chain failure before they are recorded as
  complete.

## Remaining operational limitations

- Private payout delivery still rejects the MagicBlock `sendTo=ephemeral` branch; the frontend
  intentionally auto-claims publicly until the authenticated ER transfer path is implemented and
  tested.
- A live local E2E run needs the team's Supabase service role, rotated Privy secret, and existing
  authorized Solana fee-payer key. Do not paste any of these into chat.
- MagicBlock ER caches program bytecode. Any future instruction-layout change needs a fresh
  program ID and matching IDL rather than an in-place upgrade of the current ID.
