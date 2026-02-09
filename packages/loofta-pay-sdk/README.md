# @loofta/pay-sdk

Embeddable **Loofta Pay Button** for React. The button opens your Loofta Pay checkout (your API) so you can use it in any project and keep using your own backend.

## Install

```bash
npm install @loofta/pay-sdk
# or
yarn add @loofta/pay-sdk
pnpm add @loofta/pay-sdk
```

## Usage

### React

```tsx
import { PayButton } from '@loofta/pay-sdk';

// Point to your Loofta Pay frontend (where your checkout and API live)
const CHECKOUT_BASE = 'https://pay.yoursite.com'; // or your Vercel URL, etc.

<PayButton
  organizationId="your-org-id"
  amount={100}
  checkoutBaseUrl={CHECKOUT_BASE}
  buttonText="Pay $100"
  onSuccess={(paymentId) => {
    console.log('Payment completed:', paymentId);
  }}
/>
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `organizationId` | `string` | **Required.** Your organization ID. |
| `amount` | `number \| string` | Optional payment amount (USD). |
| `checkoutBaseUrl` | `string` | **Recommended in other projects.** Base URL of your Loofta Pay app (e.g. `https://pay.loofta.com`). Checkout opens at `{checkoutBaseUrl}/checkout?...`. If omitted, uses current origin or Loofta default. |
| `buttonBgColor` | `string` | Optional button background (CSS color). |
| `pageBgColor` | `string` | Optional checkout page background. |
| `callbackUrl` | `string` | Optional URL to redirect after payment. |
| `onSuccess` | `(paymentId: string) => void` | Called when payment completes (popup mode). |
| `buttonText` | `string` | Button label (default: "Pay with Loofta"). |
| `successText` | `string` | Text after success (default: "Paid Successfully"). |
| `openMode` | `'popup' \| 'redirect' \| 'tab'` | How to open checkout (default: `popup`). |
| `disabled` | `boolean` | Disable the button. |
| `className` | `string` | Optional CSS class. |

### Same project (no `checkoutBaseUrl`)

If the button is rendered inside your Loofta Pay frontend, you can omit `checkoutBaseUrl`; it will use the current origin and your existing API.

### Other project (different domain)

Set `checkoutBaseUrl` to your deployed Loofta Pay app URL. The button will open `{checkoutBaseUrl}/checkout?organizationId=...&amount=...`, and that page will call your API as it already does.

### Embed code helpers

```tsx
import { generateEmbedCode, generateScriptEmbed } from '@loofta/pay-sdk';

// React embed snippet
const reactSnippet = generateEmbedCode({
  organizationId: 'your-org-id',
  amount: 100,
  checkoutBaseUrl: 'https://pay.yoursite.com',
});

// Script tag embed (non-React sites)
const scriptSnippet = generateScriptEmbed({
  organizationId: 'your-org-id',
  amount: 100,
  checkoutBaseUrl: 'https://pay.yoursite.com',
});
```

## Build

```bash
cd packages/loofta-pay-sdk
npm install
npm run build
```

Output: `dist/` (ESM, CJS, and types).

## Publish to npm

1. Set the package name and version in `packages/loofta-pay-sdk/package.json` (e.g. `@loofta/pay-sdk`).
2. Log in: `npm login`
3. From repo root or the package dir: `npm publish --access public` (for scoped packages like `@loofta/pay-sdk` use `--access public` once).

## License

MIT
