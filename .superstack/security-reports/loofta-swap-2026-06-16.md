# Security Audit — loofta-swap — 2026-06-16

**Mode:** Daily (8/10 confidence gate)
**Scope:** Full audit — all phases
**Stack:** Next.js 14 frontend (Vercel) + NestJS backend (Railway) + Solana Anchor program + Supabase + Redis

---

## Phase 0 — Stack Summary

| Dimension | Value |
|-----------|-------|
| Languages | TypeScript (frontend + backend), Rust (Anchor program) |
| Frameworks | Next.js 14 (App Router), NestJS 10 |
| Package manager | npm workspaces + Turborepo |
| Database | Supabase (Postgres) + Redis (ioredis / node-redis) |
| Auth | Privy (JWT Bearer tokens), verified server-side via `/users/me` proxy |
| Deployment | Vercel (frontend), Railway (backend) |
| API style | REST (NestJS controllers + Next.js route handlers) |
| Blockchain | Solana mainnet (MagicBlock PER + Anchor program `EQMRk…`) + EVM Base (ZKP2P offramp) |
| Secrets in prod | GCP KMS-wrapped (`KMS_SEND_PAYMENT_ENC_KEY`, `KMS_SOLANA_FEE_PAYER_PRIVATE_KEY`) — NOT plaintext env risk |

---

## Findings

---

### [MEDIUM] CSO-01: `/api/blink/sign` — Unauthenticated merchant signing endpoint

**Confidence:** 8/10
**Phase:** Phase 9 — OWASP A01 Broken Access Control / A07 Authentication Failures
**Location:** [apps/frontend/src/app/api/blink/sign/route.ts](apps/frontend/src/app/api/blink/sign/route.ts)

**Description:**
The `POST /api/blink/sign` endpoint signs arbitrary `amount`, `address`, and `token` values with the `BLINK_MERCHANT_PRIVATE_KEY` without requiring any user authentication. Any anonymous caller can hit this endpoint and receive a BLINK-valid signed payment payload for any amount and any Solana address.

**Exploit Scenario:**
1. Attacker sends `POST /api/blink/sign` with `{ amount: 0.01, chainId: 792703809, address: "attacker-address", token: "EPjFW..." }`
2. Server signs it with the Loofta merchant private key
3. Attacker presents this signed payload to BLINK; if BLINK doesn't independently verify the amount against a server-side payment record, attacker gets a valid signed request they didn't earn

**Evidence:**
```typescript
// No getVerifiedUserId() call anywhere in this file
export async function POST(req: NextRequest) {
  if (!MERCHANT_ID) { ... }   // only checks config
  // amount comes directly from body, no auth, no validation against a stored payment
  const { amount, chainId, address, token, ... } = body as { amount: unknown; ... };
```

**Remediation:**
Add `getVerifiedUserId()` check at the top of the handler. Optionally also validate that `amount` matches a known pending payment record in your DB keyed on `reference`.

```typescript
export async function POST(req: NextRequest) {
  const userId = await getVerifiedUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // ... rest of handler
}
```

**Priority:** P1 (fix this sprint)

---

### [MEDIUM] CSO-02: `POST /claims/:id/notify` — Unauthenticated email trigger (backend)

**Confidence:** 9/10
**Phase:** Phase 9 — OWASP A01 Broken Access Control
**Location:** [apps/backend/src/modules/claims/claims.controller.ts](apps/backend/src/modules/claims/claims.controller.ts) — `notifyPayment` method

**Description:**
The `POST /claims/:id/notify` endpoint has no auth guard — only a `@Throttle({ short: { ttl: 60000, limit: 120 } })` decorator. Anyone who can call the backend and knows (or guesses) a claim UUID can trigger email notifications to the recipient, effectively allowing anonymous email spam via Loofta's email infrastructure.

**Exploit Scenario:**
1. Attacker enumerates claim UUIDs (e.g. from public claim links they've seen shared)
2. Sends 120 requests/minute to `/claims/:uuid/notify` for each
3. Recipient receives repeated email notifications from Loofta for already-completed payments

**Evidence:**
```typescript
@Post(':id/notify')
@HttpCode(HttpStatus.OK)
@Throttle({ short: { ttl: 60000, limit: 120 } })
async notifyPayment(@Param('id') id: string): Promise<{ ok: boolean }> {
  this.claimsService.notifyRecipientAfterPayment(id);
  return { ok: true };
}
// No @UseGuards() — completely unauthenticated
```

**Remediation:**
Either add `@UseGuards(AuthGuard)` or at minimum add a shared secret header check (same pattern as `CronGuard`). The internal caller `notifyRecipientAfterPayment()` is already called directly from `updateStatus()`, so the external endpoint may be removable entirely.

**Priority:** P1 (fix this sprint)

---

### [MEDIUM] CSO-03: `ADMIN_SECRET_PATH` used as dual-purpose secret

**Confidence:** 8/10
**Phase:** Phase 9 — OWASP A02 Security Misconfiguration
**Location:** [apps/frontend/src/app/api/outreach/bulk-send/route.ts](apps/frontend/src/app/api/outreach/bulk-send/route.ts) + [apps/frontend/src/proxy.ts](apps/frontend/src/proxy.ts)

**Description:**
`ADMIN_SECRET_PATH` serves two purposes: (1) the URL path segment that reveals the admin panel, and (2) the secret used in the `x-admin-secret` header to authenticate the entire outreach API family (bulk-send, discover, draft, prospects, send-dm, config). Anyone who discovers the admin URL path (e.g., from a leaked link, error log, or browser history) automatically gains the `x-admin-secret` value needed to call the Twitter DM outreach API.

**Exploit Scenario:**
1. Admin forgets to close a browser tab on a shared computer; colleague sees the URL
2. Colleague now knows `ADMIN_SECRET_PATH`
3. They call `POST /api/outreach/bulk-send` with header `x-admin-secret: <path>` and trigger DMs to all prospects

**Evidence:**
```typescript
// proxy.ts — path is in the URL, so it appears in logs, history, etc.
const adminSegment = `/${secretPath}`;
if (pathname === adminSegment || ...) response.headers.set("X-Robots-Tag", "noindex...");

// bulk-send/route.ts — same value used as bearer secret
function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_SECRET_PATH;
}
```

**Remediation:**
Split into two env vars: keep `ADMIN_SECRET_PATH` for the URL obfuscation, and add a separate `OUTREACH_API_SECRET` for the `x-admin-secret` header check.

**Priority:** P2 (fix this month)

---

### [MEDIUM] CSO-04: Dependency vulnerabilities — 2 critical, 33 high (frontend)

**Confidence:** 9/10
**Phase:** Phase 3 — Dependency Supply Chain / Phase 9 — OWASP A03
**Location:** [apps/frontend/package.json](apps/frontend/package.json)

**Description:**
`npm audit` reports 65 vulnerabilities in the frontend (2 critical, 33 high) and 81 in the backend (23 high).

**Critical finding:**
- `dcap-qvl` Missing Verification for QE Identity (GHSA-796p-j2gh-9m2q) via `@magicblock-labs/ephemeral-rollups-sdk` → `@phala/dcap-qvl-web`. This affects Intel SGX DCAP attestation — the library used by MagicBlock TEE to prove enclave identity. A flaw here means the TEE attestation MagicBlock relies on may not be cryptographically verified correctly.

**High severity pattern:**
- `ws` ReDoS/DoS via `@zkp2p/sdk`, `ethers`, `viem` chains — can crash WebSocket-based RPC connections under adversarial input

**Remediation:**
1. Run `npm audit fix` to resolve non-breaking fixes
2. File an issue with `@magicblock-labs/ephemeral-rollups-sdk` about the `@phala/dcap-qvl-web` critical (GHSA-796p-j2gh-9m2q)
3. For `@zkp2p/sdk` ws chain, evaluate whether it's used in hot path; consider pinning or replacing with a patched fork

**Priority:** P2 (fix this month)

---

### [LOW] CSO-05: CI installs Railway CLI without version pin

**Confidence:** 8/10
**Phase:** Phase 4 — CI/CD Pipeline Security / OWASP A03
**Location:** [.github/workflows/deploy-backend.yml](.github/workflows/deploy-backend.yml)

**Description:**
The deploy workflow runs `npm install -g @railway/cli` without pinning a version. If the `@railway/cli` npm package were compromised (maintainer account takeover, malicious publish), the next deployment would execute attacker code with access to `RAILWAY_TOKEN` and the entire backend environment.

The `actions/checkout` is correctly pinned to a full commit SHA — good practice worth keeping.

**Evidence:**
```yaml
- name: Install Railway CLI
  run: npm install -g @railway/cli  # no @version pin
```

**Remediation:**
```yaml
- name: Install Railway CLI
  run: npm install -g @railway/cli@3.x.x  # pin to known-good version
```
Or better: use the official Railway GitHub Action if one exists and pin it by SHA.

**Priority:** P3 (backlog)

---

### [LOW] CSO-06: Missing HTTP security headers on frontend

**Confidence:** 9/10
**Phase:** Phase 9 — OWASP A02 Security Misconfiguration
**Location:** [apps/frontend/next.config.mjs](apps/frontend/next.config.mjs), [vercel.json](vercel.json)

**Description:**
The `next.config.mjs` headers block is missing several standard security headers. CSP is present (good), and `frame-ancestors 'none'` covers clickjacking — but the following are absent:

| Header | Risk if absent |
|--------|---------------|
| `Strict-Transport-Security` | Downgrades if visited over HTTP first |
| `X-Content-Type-Options: nosniff` | MIME-type sniffing attacks |
| `Referrer-Policy` | Leaks the admin path in the `Referer` header to third-party requests |
| `Permissions-Policy` | Camera/mic access not restricted |

**Note on CSP:** `unsafe-inline` and `unsafe-eval` in `script-src` significantly weaken the CSP. This is partially unavoidable with Spline/WalletConnect, but worth tracking for future hardening.

**Remediation:**
Add to the headers array in `next.config.mjs`:
```javascript
{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
{ key: "X-Content-Type-Options", value: "nosniff" },
{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
```

**Priority:** P2 (fix this month)

---

### [INFO] CSO-07: Redis credentials in frontend env file

**Confidence:** 7/10
**Phase:** Phase 2 — Secrets Archaeology
**Location:** `apps/frontend/.env.production` (gitignored — NOT committed)

**Description:**
`apps/frontend/.env.production` contains `REDIS_URL=redis://default:...@redis-19639...` with plaintext credentials. The file is properly gitignored. However, at build time Vercel reads `.env.production` and includes non-`NEXT_PUBLIC_` variables in server-side bundles. The credentials would appear in Vercel's build logs and be stored in their encrypted env store.

This is an architecture smell: Redis is a backend concern. The frontend's `redis-lock.ts` connects directly to Redis from within Next.js API routes rather than proxying through the NestJS backend.

**Remediation:**
Move Redis usage into the backend (NestJS already has `ioredis` configured). Remove `REDIS_URL` from the frontend env entirely. The frontend's `redis-lock.ts` should be replaced with a lock endpoint on the backend.

**Priority:** P3 (backlog)

---

### [INFO] CSO-08: `unsafe-eval` in CSP weakens XSS protection

**Confidence:** 9/10
**Phase:** Phase 9 — OWASP A02
**Location:** [apps/frontend/next.config.mjs](apps/frontend/next.config.mjs) line ~120

**Description:**
`script-src` includes `'unsafe-eval'` and `'unsafe-inline'`. These are required by Spline 3D rendering and some wallet connectors, but they mean any XSS payload that injects a script tag (or uses `eval`) won't be blocked by the CSP.

This is partially mitigated by the app's use of React (which escapes by default) and the absence of `dangerouslySetInnerHTML` with user-controlled content — the two usages in `layout.tsx` serialize hardcoded JSON-LD, not user data.

**Remediation (long-term):**
Evaluate replacing `@splinetool/react-spline` with a CSP-compatible renderer, or move Spline to an isolated iframe with its own relaxed CSP. Use `'strict-dynamic'` nonce-based CSP if possible.

**Priority:** P3 (backlog)

---

### [INFO] CSO-09: KMS SA key written to temp filesystem during startup

**Confidence:** 6/10
**Phase:** Phase 5 — Infrastructure Shadow Surface
**Location:** [apps/backend/src/common/kms-secrets.ts](apps/backend/src/common/kms-secrets.ts)

**Description:**
On Railway startup, `GCP_SA_KEY_BASE64` is decoded and written to `/tmp/gcp-sa-<pid>.json` for the GCP SDK to read. The file is deleted after KMS decryption, but there is a brief window (< 1 second) where the JSON key exists on disk. On Railway's isolated container environment this is low risk — no other process shares the container. The file is also removed even if KMS fails.

No action required in current Railway deployment. Worth revisiting if the deployment target changes to a shared-filesystem environment.

**Priority:** P3 (backlog)

---

## What's Good

- **KMS for production secrets** — `KMS_SEND_PAYMENT_ENC_KEY` and `KMS_SOLANA_FEE_PAYER_PRIVATE_KEY` are GCP KMS-wrapped on Railway. Attacker needs both the ciphertext AND GCP IAM access. Solid.
- **Helm/NestJS auth guards** — All financial endpoints (create, reclaim, claim, build-private-transfer, sign-and-broadcast) use `@UseGuards(AuthGuard)` or `@UseGuards(PrivyAuthGuard)`. The pattern is consistent.
- **Admin guard is double-checked** — Both env-var `ADMIN_PRIVY_USER_IDS` and database `role='admin'` are checked; env-var is the fast path, DB is the fallback.
- **Cron endpoints use secret header** — `CronGuard` enforces `CRON_SECRET` bearer token; no cron route is exposed unauthenticated.
- **No .env files in git** — `.gitignore` has `.env` and `.env.*`; git history confirms no env files were ever committed.
- **Swagger disabled in production** — `if (!isProduction)` guard on Swagger setup prevents API schema leakage.
- **CORS locked down** — Production CORS requires `CORS_ORIGIN` env var; falls to `false` (block all) if unset.
- **Helmet applied globally** — Standard HTTP security middleware active on NestJS.
- **MagicBlock proxy restricts paths** — `ALLOWED_PATHS = new Set(["auth/challenge", "auth/login"])` prevents open-proxy SSRF.
- **Coinbase session checks auth in production** — `getVerifiedUserId()` enforced; dev-only bypass is clearly gated.
- **dangerouslySetInnerHTML is safe** — Both usages in `layout.tsx` inject hardcoded JSON-LD, not user content.
- **GitHub Actions checkout pinned to full commit SHA** ✅

---

## Confidence Calibration

| Severity | Count | Avg Confidence |
|----------|-------|---------------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 4 | 8.5/10 |
| LOW | 2 | 8.5/10 |
| INFO | 3 | 7.3/10 |
| **Total** | **9** | |

- False positives filtered: 8 (KMS env vars, dangerouslySetInnerHTML with static JSON, Redis eval/Lua, new Function for ESM import, .env files in gitignore, Swagger disabled in prod, MagicBlock proxy path restriction, Coinbase session dev bypass)
- Mode: Daily (8/10 gate)
