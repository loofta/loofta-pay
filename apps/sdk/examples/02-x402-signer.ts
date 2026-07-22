/**
 * x402/signer path — no API key, no prior integration. The SDK drives the full
 * 402 -> sign -> settle round trip using your own Solana keypair and only resolves once the
 * payment is confirmed funded on-chain.
 *
 * NOT YET LIVE-VERIFIED end-to-end — this is the path that depends on a reachable x402
 * facilitator (see apps/backend/src/modules/x402-payments/x402-payments.controller.ts). Expect
 * to debug the facilitator round trip before this works against a real deployment.
 *
 * Setup:
 *   1. A devnet Solana keypair funded with devnet SOL (for the transaction fee — though the
 *      transaction itself is fee-paid by whoever the facilitator submits it as) and devnet USDC
 *      (mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU) in its associated token account.
 *   2. The backend running with X402_FACILITATOR_URL reachable.
 *   3. LOOFTA_SIGNER_SECRET_KEY=<base58 secret key> LOOFTA_API_URL=http://localhost:3001 \
 *        npx tsx examples/02-x402-signer.ts
 */
import { LooftaPayClient } from "../src";

async function main() {
  const secretKey = process.env.LOOFTA_SIGNER_SECRET_KEY;
  if (!secretKey) throw new Error("Set LOOFTA_SIGNER_SECRET_KEY to a base58 Solana secret key");

  const client = new LooftaPayClient({
    signer: secretKey,
    baseUrl: process.env.LOOFTA_API_URL || "http://localhost:3001",
  });

  const result = await client.payHuman({
    to: { type: "email", value: process.argv[2] || "you@example.com" },
    amount: Number(process.argv[3] || 1),
    description: "x402 path example payment",
  });

  console.log(result);
  console.log(`\nClaim link: ${result.claimLink}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
