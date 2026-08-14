# Environments

This repo runs against two completely separate environment bundles — **development/staging**
and **production**. Each bundle is a matched set: one Solana cluster, one Supabase project, one
Solana fee payer, one encryption key. They are never meant to mix, and as of 2026-08-14 the app
refuses to boot if they do (see "Coherence guard" below).

| | Development/Staging | Production |
|---|---|---|
| Solana cluster | devnet | mainnet-beta |
| Supabase project | staging | production |
| Solana fee payer | devnet-only key, holds no mainnet value | the real mainnet fee payer |
| `SEND_PAYMENT_ENC_KEY` | dev-only key | production key (KMS-wrapped on Railway) |
| Who should have it | any contributor | account owner only |

## The files

**Backend** (`apps/backend/`):
- `.env.development.local` — the default. Loaded by `npm run start:dev` / `dev:backend`.
- `.env.production.local` — production data, local machine. Loaded only via
  `npm run start:dev:prod-data`. **Never share this file or its contents.**
- Which one loads is controlled by `LOOFTA_ENV_FILE` (set by the npm script that starts the
  process), deliberately **not** `NODE_ENV` — `NODE_ENV=production` also gates every
  money-moving `@Cron` job and the KMS-secrets requirement, so tying file selection to it would
  mean pointing at production data locally could silently also turn on production automations.
  `NODE_ENV` stays `development` in both local files; only the cluster/DB/keys differ.
- Real Railway production deployment doesn't use either of these files — Railway injects real
  env vars directly into the container, and neither `.env.*.local` file exists there (both are
  gitignored, never deployed). This split only affects local development.

**Frontend** (`apps/frontend/`):
- `.env.development.local` — the default, loaded automatically by `next dev`. No extra flag
  needed (this is a Next.js built-in convention, unlike the backend's `LOOFTA_ENV_FILE`).
- `.env.production` — already existed before this split; Next.js's native production file,
  loaded by `next build`/`next start`.

Both apps' `.env.development.local` currently have a placeholder for the staging Supabase
URL/service-role key — fill those in from the staging Supabase project (Project Settings → API).
Must be the **staging** project's values in both files, never production's.

## Coherence guard

`apps/backend/src/common/env-coherence-guard.ts`, called from `main.ts` before the server starts.
Derives the fee payer's public key from whatever `SOLANA_FEE_PAYER_PRIVATE_KEY` actually loaded
and checks it against whether `SUPABASE_URL` is the production project. If exactly one of the two
says "production," the app refuses to boot with an explicit error naming the mismatch. This is
the actual safety net — which file loads is a matter of discipline (right npm script, right
`LOOFTA_ENV_FILE`), and discipline can fail under time pressure; this check inspects what
actually ended up in `process.env` regardless of how it got there, so it can't silently drift.

Both values it checks (a Supabase project ref, a Solana public key) are identifiers, not secrets
— safe to have hardcoded in that file for comparison.

## Gacha's on-chain programs (devnet-only)

`gacha-room-state` and `loofta-vrf` both gate certain instructions behind an authorized-signer
check compiled into the program (`AUTHORIZED_INITIALIZER` / `AUTHORIZED_REQUESTER`). As of
2026-08-14 both were rotated off the shared mainnet/devnet fee payer key onto the devnet-only key
described above:

- `gacha-room-state` needed a **fresh program id** for this — MagicBlock's Ephemeral Rollup
  caches a program's bytecode per program id and won't pick up an in-place upgrade once that id
  has been referenced on the ER, so any authority change (or future instruction change) forces a
  new id, not an upgrade.
- `loofta-vrf` did **not** need a fresh id — it's never itself delegated to the ER, so it was
  upgraded in place (same program id, new authorized-requester).

Both program ids are read from env now (`GACHA_ROOM_STATE_PROGRAM_ID` / `LOOFTA_VRF_PROGRAM_ID`
on the backend, `NEXT_PUBLIC_GACHA_ROOM_STATE_PROGRAM_ID` on the frontend) instead of being
compiled into source, so a future redeploy only needs an env update, not a code change. See
`apps/backend/src/modules/gacha/README.md` for the current ids.

## KMS

Production-only. `SEND_PAYMENT_ENC_KEY` and `SOLANA_FEE_PAYER_PRIVATE_KEY` are KMS-wrapped on
Railway for production (see `apps/backend/src/common/kms-secrets.ts`). Dev/staging secrets are
plain env vars — KMS exists to protect high-value secrets on a shared production server; a
devnet fee payer holding worthless devnet SOL and a staging DB with no real user data don't carry
that risk, and adding KMS there would only add operational overhead for anyone doing local dev.

## Supabase access

Staging lives in the same Supabase organization as production today (no project-scoped roles —
that's a Team-plan feature). A contributor's Supabase account being a member of that org means
they can browse the production project in the dashboard (Table Editor, SQL Editor) through their
own login, independent of any key in an env file — that's a separate exposure from anything above
and isn't closed by this file split. If that gap matters, the fix is moving staging into its own
organization that doesn't contain production at all, not an env change.

## Rotating a leaked or over-shared secret

Unlike a database password or org membership, a raw secret that's already left your hands can't
be un-shared — regenerate it:
- Supabase service-role key: Project Settings → API Keys → regenerate (update Railway after).
- Solana fee payer: generate a new keypair, fund it, update wherever it's used. For a
  production key this also means updating every on-chain program authority that references it.
- Any other API key: through that provider's dashboard.
