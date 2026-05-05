# Anti-spam: Cloudflare Turnstile on waitlist forms

## Problem
Public forms (like the mainnet waitlist) get flooded by bots — hundreds of fake submissions with no real Loofta connection.

## Solution
Cloudflare Turnstile — invisible CAPTCHA, no image puzzles, free tier, privacy-friendly.

---

## Setup (one-time, per form)

### 1. Cloudflare dashboard
- Go to **Turnstile** in the Cloudflare sidebar
- Create a widget → note the **Site Key** (public) and **Secret Key** (private)
- Widget type: **Managed** (auto-solves for real users, shows challenge for bots)

### 2. Env vars
| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | frontend `.env.local` + Railway frontend service | Public — safe to expose in browser |
| `TURNSTILE_SECRET_KEY` | frontend `.env.local` + Railway frontend service | Private — server-side only, never in browser |

Both go in the **frontend** app because the API route that validates lives in Next.js (`/api/...`).

### 3. Install package
```bash
cd apps/frontend
npm install @marsidev/react-turnstile
```

---

## Implementation pattern

### Frontend — page component

```tsx
import { Turnstile } from "@marsidev/react-turnstile";

// State
const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

// Widget — render on the landing/start screen
// appearance="interaction-only" = invisible unless bot detected
<Turnstile
  siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
  onSuccess={setTurnstileToken}
  onExpire={() => setTurnstileToken(null)}
  options={{ appearance: "interaction-only" }}
  className="fixed bottom-4 right-4 z-50"
/>

// Gate the CTA button until token is ready (usually instant for real users)
<button
  onClick={onStart}
  disabled={!turnstileToken}
>
  {turnstileToken ? "Request access →" : "Verifying…"}
</button>

// Include token in form submission
fetch("/api/my-form", {
  method: "POST",
  body: JSON.stringify({ ...formData, turnstile_token: turnstileToken }),
});
```

**Key points:**
- Keep the `<Turnstile>` mounted for the full session so the token auto-refreshes (5 min TTL)
- `turnstileToken` state lives in the page component so it's always current at submit time
- For multi-step forms: mount the widget on step 1 / landing, submit the token on the final step

### Backend — API route

```ts
// apps/frontend/src/app/api/my-form/route.ts

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY!,
      response: token,
      remoteip: ip,
    }),
  });
  const data = await res.json();
  return data.success === true;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { turnstile_token, ...rest } = body;

  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "unknown";

  if (!turnstile_token || !(await verifyTurnstile(turnstile_token, ip))) {
    return NextResponse.json(
      { error: "Bot check failed. Please refresh and try again." },
      { status: 403 }
    );
  }

  // ... rest of the handler
}
```

**Key points:**
- Always verify server-side — client-side checks are trivially bypassed
- Use `cf-connecting-ip` header (set by Cloudflare proxy) for the real IP
- Reject before any DB work (`status: 403`)
- Turnstile tokens are single-use — Cloudflare rejects a reused token

---

## Where it's used

| Form | Page | API route |
|---|---|---|
| Mainnet waitlist | `apps/frontend/src/app/app/waitlist/page.tsx` | `apps/frontend/src/app/api/mainnet-waitlist/route.ts` |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Button stuck on "Verifying…" | Wrong site key or domain not allowlisted in Cloudflare | Check Turnstile widget domains in dashboard |
| 403 on every submission in prod | Missing `TURNSTILE_SECRET_KEY` on Railway | Add env var to frontend Railway service |
| 403 on every submission locally | Using prod secret key with prod site key | Cloudflare provides dedicated test keys for local dev (see below) |

### Test keys (local dev)
Cloudflare publishes always-pass test keys:
- Site key: `1x00000000000000000000AA`
- Secret key: `1x0000000000000000000000000000000AA`

Use these in `.env.local` to bypass the widget during development without network calls.
