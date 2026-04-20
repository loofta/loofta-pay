import { Connection } from "@solana/web3.js";
import { getSolanaCluster } from "@/lib/solanaCluster";

/**
 * Wait until a signature reaches confirmed/finalized using HTTP polling.
 * More reliable than Connection.confirmTransaction on devnet (avoids WS flakes / 30s cap).
 */
async function getStatusWithFallback(
  connection: Connection,
  signature: string,
  fallback?: Connection,
): Promise<{ status: Awaited<ReturnType<Connection["getSignatureStatuses"]>>["value"][0]; rpc: string }> {
  try {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    if (value[0] != null || !fallback) return { status: value[0], rpc: connection.rpcEndpoint };
  } catch (err) {
    if (!fallback) throw err;
  }
  // Primary returned null or threw — try fallback RPC
  const { value } = await fallback!.getSignatureStatuses([signature], { searchTransactionHistory: true });
  return { status: value[0], rpc: fallback!.rpcEndpoint };
}

export async function waitForSignatureConfirmation(
  connection: Connection,
  signature: string,
  timeoutMs = 120_000,
  pollIntervalMs = 1500,
  /** Shown in console when polling is slow (e.g. PER action name). */
  stepLabel?: string,
  /** Secondary RPC tried when primary returns null or throws (e.g. base Solana when primary is ephemeral). */
  fallbackConnection?: Connection,
): Promise<void> {
  const label = stepLabel ?? "confirm";
  const start = Date.now();
  let lastProgressLog = 0;
  while (Date.now() - start < timeoutMs) {
    const { status, rpc } = await getStatusWithFallback(connection, signature, fallbackConnection);
    const elapsed = Date.now() - start;
    if (status?.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized" ||
      status?.confirmationStatus === "processed"
    ) {
      if (elapsed > 2000) {
        console.info(
          `[PER confirm] (${label}) ${signature.slice(0, 12)}... ${status.confirmationStatus} after ${elapsed}ms rpc=${rpc}`,
        );
      }
      return;
    }
    if (elapsed - lastProgressLog >= 5000) {
      lastProgressLog = elapsed;
      const hint =
        status == null
          ? "getSignatureStatuses[0] is null — tx not indexed on this RPC yet or wrong cluster"
          : `confirmationStatus=${String(status.confirmationStatus)}`;
      console.warn(
        `[PER confirm] (${label}) still waiting ${elapsed}ms — ${hint} rpc=${rpc} sig=${signature.slice(0, 12)}...`,
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  const { status, rpc } = await getStatusWithFallback(connection, signature, fallbackConnection);
  if (status?.err) {
    throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
  }
  if (
    status?.confirmationStatus === "confirmed" ||
    status?.confirmationStatus === "finalized" ||
    status?.confirmationStatus === "processed"
  ) {
    return;
  }
  const cluster = getSolanaCluster();
  throw new Error(
    `[PER confirm] (${label}) ${timeoutMs}ms timeout cluster=${cluster} rpc=${rpc}. ` +
      `If status stayed null, cluster mismatch or tx never landed. Signature: ${signature}`,
  );
}

