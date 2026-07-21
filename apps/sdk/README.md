# @loofta/pay-sdk

Pay any human by email, username, or social handle with stablecoin (USDC on Solana) — SDK for
the Loofta Pay Protocol. Published publicly to npm; there are no secrets baked into the package
itself — access control lives entirely at the integrator-key/x402-signer layer, not the package.

## Install

```bash
npm install @loofta/pay-sdk
```

## Two ways to pay, one call

```ts
import { LooftaPayClient } from "@loofta/pay-sdk";

// Integrator API key — your own system is responsible for actually sending the
// USDC to the returned deposit address (see result.depositAddress).
const loofta = new LooftaPayClient({ apiKey: "lft_live_..." });

// OR: an agent with its own Solana signer — no API key, no prior integration at all.
// The SDK drives the full x402 402 -> sign -> settle round trip and only resolves
// once the payment is confirmed funded on-chain.
const loofta = new LooftaPayClient({ signer: agentSecretKeyBytes });

const result = await loofta.payHuman({
  to: { type: "email", value: "alice@example.com" }, // or username/twitter/discord/github/telegram
  amount: 5,
  description: "thanks for the help",
});

console.log(result.claimLink); // hand this to the recipient — they claim it at link.loofta.xyz
```

`result.status` tells you which case you're in: `"FUNDED"` (x402 path — already done) or
`"PENDING_DEPOSIT"` (API-key path — your system still needs to send
`result.requiredAmountBaseUnits` of USDC to `result.depositAddress`).

## Agent-tool wrapper

```ts
import { LooftaPayClient } from "@loofta/pay-sdk";
import { createPayHumanTool } from "@loofta/pay-sdk/agent-tool";

const client = new LooftaPayClient({ signer: agentSecretKeyBytes });
const payHumanTool = createPayHumanTool(client);
// payHumanTool = { name, description, input_schema, handler } — shaped like an Anthropic
// tool-use definition; drop it straight into a tools array, or lift schema/handler out for
// another agent framework (LangChain, OpenAI function-calling, MCP, etc.)
```

## Notes

- Node.js only for now (uses `Buffer`; a browser build is a reasonable follow-up if there's
  demand for signing directly from a browser-extension wallet).
- Only USDC on Solana is supported today — matches the protocol's own v1 scope.
- The x402 path constructs and signs a real Solana transaction using `@solana/web3.js` directly
  rather than `@x402/svm`'s client (which uses the newer `@solana/kit`/web3.js-v2 ecosystem) —
  keeps this package's dependency footprint small and consistent with the rest of Loofta's stack.
