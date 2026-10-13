---
name: same-origin-api
description: Always call the Nest backend from the browser via a Next.js /api/* route, never NEXT_PUBLIC_BACKEND_URL or Railway directly. Use when adding a frontend fetch, lookup, create-claim, pay-target, or any browser call to apps/backend — or when a request is 200 but DevTools shows a CORS error.
---

# Same-origin API (never fetch Railway from the browser)

The frontend (pay.loofta.xyz / Vercel) and the Nest API (Railway) are different origins. Helmet sets `Cross-Origin-Resource-Policy: same-origin`, and production `CORS_ORIGIN` often does not echo the app host. The browser then reports a **CORS error on a 200** and the JS never sees the JSON.

That is how a registered handle (`lisabeyy`) was treated as unregistered and charged the $0.10 claim fee: `GET …/users/pay-target` succeeded, CORS hid the body, the form assumed `registered: false`.

## Always do this

1. Browser / `'use client'` code fetches **only** a same-origin path: `/api/…`.
2. `apps/frontend/src/app/api/**/route.ts` calls Railway with `NEXT_PUBLIC_BACKEND_URL` (server-side, no CORS).
3. Return only the public-safe fields the UI needs.

```ts
// browser — yes
await fetch(`/api/users/pay-target?${q}`);

// browser — never
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
await fetch(`${backendUrl}/users/pay-target?${q}`);
```

Reference: `apps/frontend/src/lib/lookupPayTarget.ts` → `apps/frontend/src/app/api/users/pay-target/route.ts`.

## If you see 200 + CORS

Do not add more `CORS_ORIGIN` hosts as the first fix. Proxy through `/api` like pay-target. Then the send form (and any other lookup) can trust the response.

`NEXT_PUBLIC_BACKEND_URL` in a **Route Handler, Server Component, or `services/api` used only on the server** is fine. The ban is the **browser**.
