const STALE_BRIDGING_MS = 10 * 60_000;

/**
 * A cash out only leaves BRIDGING when the user's open browser signs the Peer deposit on Base.
 * A row still BRIDGING without a deposit after a few minutes has finished bridging and is
 * waiting on the user to come back and approve, so say that instead of "BRIDGING".
 */
export function cashoutStatusLabel(row: { status: string; zkp2p_deposit_id?: string | null; created_at: string }): string {
  if (row.status === "BRIDGING" && !row.zkp2p_deposit_id && Date.now() - new Date(row.created_at).getTime() > STALE_BRIDGING_MS) {
    return "AWAITING APPROVAL";
  }
  return row.status;
}
