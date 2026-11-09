# Loofta backend: Fly.io only

As of 2026-11-06 the backend (`apps/backend`) is hosted on **Fly.io only**. Railway is no longer a deploy target
for it.

## How it deploys

- Fly app: `loofta-api` (region `fra`, ONE machine), URL https://loofta-api.fly.dev
- Config: `apps/backend/fly.toml` + `apps/backend/Dockerfile`
- Auto-deploy: `.github/workflows/deploy-backend-fly.yml` runs on every push to `main` touching `apps/backend/**`
  (needs repo secret `FLY_API_TOKEN`; renew with `fly tokens create deploy -a loofta-api`).
- Manual deploy: `cd apps/backend && fly deploy -c fly.toml -a loofta-api --ha=false`
- Keep exactly one machine. Two production instances race each other on crons and double-pay.

## Crons

Crons are gated by `DISABLE_CRONS` (`src/common/cron-gate.ts`). `fly.toml` defaults it to `true`, so for Fly to be the
only host it must run with `DISABLE_CRONS=false` as a Fly secret:

    fly secrets set DISABLE_CRONS=false -a loofta-api
    fly ssh console -a loofta-api -C "printenv DISABLE_CRONS"   # must print false

Only do this once Railway is stopped, never while both are running.

## Removing Railway (what was done, what is left)

Done in the repo:
- `apps/backend/railway.json` deleted.
- No GitHub workflow deploys to Railway.

Must be done in Railway (the push trigger lives in Railway, not in the repo):
1. Project `loofta`, service `loofta-pay` (the backend) -> Settings -> Source -> **Disconnect** the GitHub repo.
   This is what stops deploy-on-push.
2. Stop the running deployment: `cd apps/backend && railway down -y` (or Deployments -> Remove).
3. Optionally delete the `loofta-pay` service once Fly has run clean for a few days.

Not affected: `twitter-service` and `loofta-main` are other Railway services; `apps/twitter-bot/railway.json` is the bot,
not the backend.

## Before stopping Railway, check

- Vercel `NEXT_PUBLIC_BACKEND_URL` (and anything else) points at `https://loofta-api.fly.dev`, not the
  `loofta-pay-production.up.railway.app` URL.
- `looftabot` `LOOFTA_API_URL`, `apps/link` `NEXT_PUBLIC_API_URL`.
- Third-party webhooks (Helius, Privy, PAJ, Rhinestone, Telegram) registered with the Railway URL.
- All env vars exist on Fly (`fly secrets list -a loofta-api`), including the `KMS_*` ciphertexts and `GCP_SA_KEY_BASE64`.

## Rollback

See `.claude/skills/backend-host-switch/SKILL.md` section B (Fly -> Railway). Turn Fly crons OFF first.
