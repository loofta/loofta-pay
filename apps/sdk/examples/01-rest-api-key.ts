/**
 * REST/API-key path — the simplest way to use the protocol. Your own system is responsible for
 * actually sending the USDC to the returned deposit address; the SDK's job here is just to
 * create the payment record and hand you back where to send it.
 *
 * Setup:
 *   1. Run the backend locally (npm run dev:backend from the repo root) with the
 *      integrators migration applied and INTEGRATOR_KEY_PEPPER set.
 *   2. Provision a test integrator (needs a Privy admin token — see examples/README.md):
 *        curl -X POST http://localhost:3001/admin/integrators \
 *          -H "Authorization: Bearer <privy-admin-token>" \
 *          -H "Content-Type: application/json" \
 *          -d '{"name": "test-integrator", "is_devnet_only": true}'
 *      Save the returned `api_key`.
 *   3. LOOFTA_API_KEY=lft_test_... LOOFTA_API_URL=http://localhost:3001 npx tsx examples/01-rest-api-key.ts
 */
import { LooftaPayClient } from "../src";

async function main() {
  const apiKey = process.env.LOOFTA_API_KEY;
  if (!apiKey) throw new Error("Set LOOFTA_API_KEY to a key minted via POST /admin/integrators");

  const client = new LooftaPayClient({
    apiKey,
    baseUrl: process.env.LOOFTA_API_URL || "http://localhost:3001",
  });

  const result = await client.payHuman({
    to: { type: "email", value: process.argv[2] || "you@example.com" },
    amount: Number(process.argv[3] || 1),
    description: "REST path example payment",
  });

  console.log(result);
  if (result.status === "PENDING_DEPOSIT") {
    console.log(
      `\nSend ${result.requiredAmountBaseUnits} USDC base units (${(Number(result.requiredAmountBaseUnits) / 1e6).toFixed(2)} USDC) to:`,
      result.depositAddress,
    );
    console.log("Then confirm with:");
    console.log(
      `  curl -X POST ${process.env.LOOFTA_API_URL || "http://localhost:3001"}/integrators/v1/pay-human/${result.paymentId}/verify-funded -H "Authorization: Bearer ${apiKey}"`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
