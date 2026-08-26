/**
 * Receive side of the protocol — create a checkout link that pays YOU, no on-chain plumbing on
 * your end. The payer opens the returned `url`, logs in, and pays; you get the exact `amount`,
 * fees included on their side.
 *
 * Setup:
 *   1. Run the backend locally (npm run dev:backend from the repo root).
 *   2. Log into the Loofta app as yourself, open Settings -> Developer, and provision a
 *      self-serve API key (POST /integrators/self-serve, needs a Privy session — easiest via the
 *      app's own "Generate API key" button). Save the returned `api_key`.
 *   3. LOOFTA_API_KEY=lft_test_... LOOFTA_API_URL=http://localhost:3001 npx tsx examples/04-create-payment-link.ts
 */
import { LooftaPayClient } from "../src";

async function main() {
  const apiKey = process.env.LOOFTA_API_KEY;
  if (!apiKey) throw new Error("Set LOOFTA_API_KEY to a key minted via POST /integrators/self-serve");

  const client = new LooftaPayClient({
    apiKey,
    baseUrl: process.env.LOOFTA_API_URL || "http://localhost:3001",
  });

  const link = await client.createPaymentLink({
    amount: Number(process.argv[2] || 25),
    message: process.argv[3] || "Invoice #1042",
  });

  console.log(link);
  console.log(`\nShare this with your payer: ${link.url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
