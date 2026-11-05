# @loofta/portal

Payout portal your users see inside your own app. They see what they were paid and withdraw it, with no Loofta account.

## 1. Mint a token on your server

```ts
// POST https://<loofta-api>/payouts/portal-token   (Authorization: Bearer <your lft_live_ key>)
const { token } = await fetch(`${LOOFTA_API}/payouts/portal-token`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.LOOFTA_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ external_user_id: currentUser.id }),
}).then((r) => r.json());
```

Tokens last 15 minutes and are scoped to that one user. Expose a route of your own that returns one for the signed-in user. Never ship your API key to the browser.

## 2. Render

React:

```tsx
import { PayoutPortal } from "@loofta/portal";

<PayoutPortal
  getToken={() => fetch("/api/loofta-token").then((r) => r.json()).then((j) => j.token)}
  theme={{ accent: "#7c3aed", accentText: "#fff", background: "#0b0b0f" }}
/>
```

No React:

```html
<div id="payouts"></div>
<script src="https://unpkg.com/@loofta/portal/dist/loofta-portal.global.js"></script>
<script>
  LooftaPortal.mount("#payouts", {
    getToken: () => fetch("/loofta-token").then((r) => r.json()).then((j) => j.token),
  });
</script>
```

## Or skip the UI: hosted page

`POST /payouts/portal-link` with `{ external_user_id, return_url }` returns a `url`. Redirect the user there; they land on a Loofta-hosted page with a back link to your `return_url`.
