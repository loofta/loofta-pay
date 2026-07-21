# Loofta Link

Standalone claim experience for protocol-originated payments (integrator API / x402 agent
payments) — deployed and released independently from `apps/frontend`. See
`.claude/plans/eager-noodling-wand.md` (Layer 4) in the repo history for the full design
rationale.

Unlike `pay.loofta.xyz/c/:id`, this app never provisions a Loofta-managed embedded wallet — a
recipient verifies their identity via Privy (same mechanism, same account system as the main
app), then claims straight to an external wallet they paste or connect. This app holds no
database credentials at all; every request goes through `apps/backend`'s public API
(`/claims/:id/summary`, `/claims/:id/claim`).

## Local development

```bash
cp .env.example .env.local   # fill in NEXT_PUBLIC_PRIVY_APP_ID at minimum
npm run dev --workspace=@loofta/link
```

## Deployment

This is a genuinely separate deployment from `apps/frontend` (which fronts three domains —
`loofta.xyz`, `pay.loofta.xyz`, `loofta.com` — from one Vercel project via `src/proxy.ts`
host-header branching). `apps/link` doesn't use that pattern at all; it's single-domain by
design, which is simpler in that one respect.

1. **New Vercel project** rooted at `apps/link` in this monorepo (Vercel's per-project "root
   directory" setting) — independent build/deploy pipeline and preview URLs from
   `apps/frontend`'s project, same as `apps/twitter-bot` already has its own independent Railway
   deployment rather than inheriting `apps/frontend`'s.
2. **Domain**: register `link.loofta.xyz` as a custom domain on that Vercel project (DNS: same
   CNAME/A record pattern as the existing `pay.loofta.xyz`/`loofta.com` setup).
3. **Privy**: add `link.loofta.xyz` as an additional allowed domain on the *same* Privy app
   instance used by `apps/frontend` (exactly how `loofta.com` was added for the Telegram relay
   page) — same app ID/secret, same user base. Do not create a second Privy app.
4. **CORS**: add `link.loofta.xyz` to `apps/backend`'s CORS allowlist alongside
   `pay.loofta.xyz`/`loofta.com`, so this frontend can call `/claims/*` cross-origin.
5. **Env vars**: set `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_API_URL` (pointing at
   `apps/backend`'s deployed URL), `NEXT_PUBLIC_SOLANA_CLUSTER`, and optionally
   `NEXT_PUBLIC_HELIUS_API_KEY` on the new Vercel project — independent config, not shared
   runtime state with `apps/frontend`.

## What's intentionally out of scope for v1

- **Cross-chain / multi-token claiming.** Only USDC on Solana. A destination-chain/token selector
  is real future work (the Megapot bridge's existing Relay integration is a natural fit to reuse
  later) but adds meaningfully more surface (slippage, bridge failure states, multi-chain fee
  display) than a first ship needs.
- **Telegram identity verification.** Requires the `loofta.com` relay-domain workaround (Telegram's
  login widget is blocked on non-.xyz — er, blocked specifically the way it's currently
  registered); wiring that relay to redirect back to `link.loofta.xyz` instead of
  `pay.loofta.xyz` is a small follow-up, not done here.
- **Inline "connect a new wallet" flow.** The claim form always accepts a pasted address (always
  correct, zero dependency on a browser wallet extension being installed) and pre-fills from an
  already-Privy-linked external Solana wallet if the visitor has one (`user.linkedAccounts`) —
  this is the "remembered wallet" network-effect hook the design calls for. Triggering Privy's
  wallet-connect modal inline (rather than only picking up wallets already linked from a prior
  session) is a reasonable v1.1 addition once this is live and the core flow is validated.
