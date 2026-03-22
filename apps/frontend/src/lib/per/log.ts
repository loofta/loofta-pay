import { LOOFTA_PER_PROGRAM_ID } from "./constants";
import { getSolanaCluster } from "@/lib/solanaCluster";
import { EPHEMERAL_RPC_URL } from "./constants";

type PerErrorContext = {
  step: string;
  userPubkey?: string;
  instruction?: string;
  signature?: string;
};

/** Structured PER errors — never log raw TEE auth tokens. */
export function logPerError(err: unknown, ctx: PerErrorContext): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[PER]", {
    ...ctx,
    cluster: getSolanaCluster(),
    programId: LOOFTA_PER_PROGRAM_ID.toBase58(),
    magicblockBase: EPHEMERAL_RPC_URL,
    message,
  });
}
