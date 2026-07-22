# Examples

Three runnable scripts, in order of how much setup each needs.

```bash
cd apps/sdk
npm install
```

## 0. One-time setup (needed for all three)

1. Apply the new migration if you haven't:
   `apps/backend/supabase/migrations/20260721100000_create_integrators_tables.sql`
2. Set `INTEGRATOR_KEY_PEPPER` in `apps/backend/.env.local` (any random string for local testing).
3. Start the backend: `npm run dev:backend` from the repo root.

## 1. REST/API-key path — `examples/01-rest-api-key.ts`

Provision a test integrator first. This needs a Privy admin token — easiest local route: add your
own Privy user ID to `ADMIN_PRIVY_USER_IDS` in the backend's `.env.local`, log into the app
normally, grab your access token from devtools, then:

```bash
curl -X POST http://localhost:3001/admin/integrators \
  -H "Authorization: Bearer <your Privy access token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-integrator", "is_devnet_only": true}'
```

Save the returned `api_key`, then:

```bash
LOOFTA_API_KEY=lft_test_... npm run example:rest -- you@example.com 1
```

The response gives you a deposit address — send that much devnet USDC there from any wallet, then
call `verify-funded` (the script prints the exact curl command) to confirm it and mark the
payment `FUNDED`.

## 2. x402/signer path — `examples/02-x402-signer.ts`

**Not yet live-verified end to end** — this depends on a facilitator your backend can actually
reach. Expect to debug this one.

Needs a devnet Solana keypair funded with devnet SOL and devnet USDC
(mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`):

```bash
LOOFTA_SIGNER_SECRET_KEY=<base58 secret key> npm run example:x402 -- you@example.com 1
```

## 3. Agent demo — `examples/03-agent-demo.ts`

The one worth recording. Type an instruction in plain English; Claude decides it's a payment
request and calls `pay_human` for real via the agent-tool export.

```bash
ANTHROPIC_API_KEY=... LOOFTA_API_KEY=lft_test_... \
  npm run example:agent -- "send $5 to alice@example.com for the design review"
```

(Or set `LOOFTA_SIGNER_SECRET_KEY` instead of `LOOFTA_API_KEY` to run the agent over the x402
path — same caveat as example 2.)

By default it asks for a y/n confirmation before actually executing the payment (it's real money,
even on devnet accounting). Pass `--yes` to skip the prompt for a clean recorded take:

```bash
npm run example:agent -- "send $5 to alice@example.com" --yes
```

If `ANTHROPIC_API_KEY` isn't set, the script falls back to whatever `ant auth login` profile is
active — no need to hardcode a key if you've already authenticated the CLI once.
