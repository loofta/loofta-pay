import { Connection } from "@solana/web3.js";

/**
 * Wait until a signature reaches confirmed/finalized using HTTP polling.
 * More reliable than Connection.confirmTransaction on devnet (avoids WS flakes / 30s cap).
 */
export async function waitForSignatureConfirmation(
  connection: Connection,
  signature: string,
  timeoutMs = 120_000,
  pollIntervalMs = 1500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];
    if (status?.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  const { value } = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  const status = value[0];
  if (status?.err) {
    throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
  }
  if (
    status?.confirmationStatus === "confirmed" ||
    status?.confirmationStatus === "finalized"
  ) {
    return;
  }
  throw new Error(
    `Transaction was not confirmed within ${timeoutMs}ms. Signature: ${signature}`,
  );
}

