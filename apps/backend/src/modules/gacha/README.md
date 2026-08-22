# Gacha Pack Party

Gacha is a devnet-only pooled CollectorCrypt pack game. Authenticated users pay the configured
USDC-Dev entry, the treasury purchases and opens one real devnet pack, MagicBlock VRF excludes
players, survivors vote on further cuts, and the final survivors split the verified buyback
proceeds.

The frontend entry route is `/app/gacha`; the guided join flow is `/app/gacha/play`; a room is
`/app/gacha/:roomId`. Private share links use `/app/gacha/invite/:inviteCode` and hand off to the
same explicit browser/join flow. The frontend proxies REST calls through `/api/gacha/*` to the Nest backend.
The play route lists public waiting rooms for the selected size, defaults to the fullest one, and
builds the entry transaction for the exact room the player selected. There is no Quick Play or
automatic room-placement endpoint: every new entry starts in the explicit room browser.
When the ER subscription flag is enabled, ready/vote reads come directly from the delegated room
PDA; Socket.IO remains the fallback and carries database-only lifecycle/mascot/exclusion events.

## Network and deployed programs

Everything in this module is explicitly Solana devnet, independent of the app-wide mainnet
settings.

- Gacha USDC-Dev mint: `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` (6 decimals)
- Gacha room-state program (devnet): `4kiFU74UWmDSyxmCmUXxjVVge5heuMc4ptf1j1hi7iWP` — read from
  `GACHA_ROOM_STATE_PROGRAM_ID` / `NEXT_PUBLIC_GACHA_ROOM_STATE_PROGRAM_ID` env, not hardcoded
- Loofta VRF program (devnet): `7vV8V59ziNPvCnXqEsYFonymXpfjq5WPGNyJ1GVKgE9c` — read from
  `LOOFTA_VRF_PROGRAM_ID` env (previous revision of this doc listed the *mainnet* id here by
  mistake; the mainnet giveaways deployment is the separate `5yv9aXx1vjRoCH1Ubxi7RNQggv9NHXxZC7zwUKLG4jYi`)
- MagicBlock base RPC: `https://rpc.magicblock.app/devnet`
- MagicBlock router: `https://devnet-router.magicblock.app/`
- CollectorCrypt API: `https://dev-gacha.collectorcrypt.com`

Both programs' devnet deployments are controlled by a devnet-only fee-payer key (see
`.env.development.local` / ENVIRONMENTS.md) — safe to share with any contributor, since it holds
no mainnet value or authority. It is NOT the same key as the mainnet payments fee payer.

The room-state program was redeployed to a fresh id on 2026-08-14 (superseding
`45ShoiSQG8J4t1piSwsfYC38dyc9oLBbZmFr6W1KpowH`, itself superseding the original
`9TebHwRo3q3mhncqKpuBvACdiwPthR2JfyBrwJW6a8Lt`) specifically to rotate `AUTHORIZED_INITIALIZER`
off the shared mainnet/devnet fee-payer key onto a devnet-only one — the ER bytecode-caching
behavior noted below means this can never be an in-place upgrade once a program id has been
referenced on the devnet ephemeral rollup, so any *future* instruction-layout change, or any
future authority rotation, needs another fresh id for the same reason. `loofta-vrf`'s devnet
deployment does NOT need a fresh id for an authority change — it's never itself delegated to the
ER, so it was upgraded in place instead (same id, new `AUTHORIZED_REQUESTER`).

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

Apply all migrations through `20260816120000_gacha_run_it_back.sql`. The Gacha
hardening and room-browser migrations add:

- atomic payout-claim locks;
- idempotent failed-join refund records;
- room/config bounds required by the exclusion game and u16 on-chain masks;
- unique room seat numbers and bid payment hashes;
- immutable locked mascots;
- stable room names, visibility, and creator metadata;
- private-room invite codes with a unique index;
- advisory-lock-protected room numbering and explicit room creation.
- an atomic user/config create guard so duplicate create retries cannot make parallel waiting
  rooms for the same player and size.
- an idempotent rematch group linking one settled room to one shared next waiting room, with the
  real (non-bot) source participants recorded for authorization.

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

# Opt-in staging DB checks (creates disposable rooms and cleans them up afterward)
set -a; source apps/backend/.env.development.local; set +a
GACHA_DB_INTEGRATION=true npm test --workspace=@loofta/backend -- --runInBand src/modules/gacha/gacha-room-browser-db.spec.ts
```

The backend cron advances the MagicBlock VRF exclusion and voting lifecycle in every environment,
because a VRF request must be polled to receive its asynchronous fulfillment. The legacy
bidding/settlement sweep remains `NODE_ENV=production`-only, preventing a local process from
racing the shared production deployment. Local dev tools still expose authenticated,
non-production-only force-advance endpoints as recovery/debugging fallbacks.

## Security and correctness invariants

- The backend derives the Solana wallet from the authenticated Privy user; join callers cannot
  nominate an arbitrary wallet for treasury auto-funding.
- Every entry payment is verified on-chain for devnet mint, treasury credit, sender, exact memo,
  success, and replay protection.
- The waiting-to-purchasing update is a conditional atomic claim, so the last-seat race cannot
  buy two packs.
- Explicit joins bind the payment memo to the selected room id. The database seat trigger
  serializes final participant inserts, and room creation serializes per-config room-number
  allocation, so concurrent requests cannot oversell capacity or race duplicate room numbers.
- Selecting a different room never silently redirects to an existing private/public seat. A
  participant may release that seat only while the room is non-full and still waiting; the
  atomic leave function archives its payment audit row, fills future seat-number gaps safely,
  and cancels the room when its final participant leaves. Waiting-room leaves do not refund the
  Devnet test entry.
- Three paid creator create/cancel cycles within a rolling ten-minute window block that user from
  creating another room for one hour. Empty, unpaid room cancellation does not count. Durable
  database events and an insert guard enforce the cooldown even when Redis is unavailable.
- Private rooms are excluded from public room lists. Their random invite code is the bearer
  capability: room detail, payment preparation, and payment confirmation accept it (or an
  existing participant/creator) and otherwise return the same not-found response as an unknown
  room. Public room links remain directly joinable by authenticated users; private links are the
  only discovery path for private rooms.
- `POST /gacha/rooms/:id/run-it-back` is participant-only and idempotently creates one next room
  for the settled source room. It never charges automatically: every returning player signs a
  fresh entry payment in the normal explicit join flow. Public rematch seats remain available to
  ordinary browser joiners; private rematches stay invite-only and receive a new invite code.
- A public room detail link carries that exact room id and size into the play flow; it never falls
  back to a different public room. If the linked room is no longer waiting, the browser keeps the
  other rooms visible and asks the player to choose again.
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
