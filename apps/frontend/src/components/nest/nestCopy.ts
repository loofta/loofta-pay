/**
 * One place that turns a stored trade `reason` into user-facing words. New rows are already
 * human ("Added $3.10 — rebalancing to target mix"); older rows carry the engine's pre-2026-09-21
 * raw format ("rebalance: elfa score 0.41, buy $7.25") from when position sizing was tilted by an
 * attention signal.
 *
 * Those legacy rows are deliberately NOT narrated with attention wording any more. The tilt was
 * backtested, found to have no edge, and removed from the live engine (see
 * nest-rebalance.service.ts and scripts/nest-backtest/RESULTS.md) — so telling someone their old
 * trade happened because "attention was cooling" describes a mechanism the product no longer has.
 * What was always true of those rows is the part we keep: the engine was moving the position
 * toward its target weight.
 */
export function humanizeReason(reason: string | null | undefined, side: "buy" | "sell", usdValue: number): string {
  const amount = `$${Math.abs(usdValue).toFixed(2)}`;
  const verb = side === "buy" ? "Added" : "Trimmed";
  const raw = (reason ?? "").replace("[SIMULATED] ", "").trim();
  if (!raw) return `${verb} ${amount}`;
  if (!/^rebalance:/i.test(raw)) return raw; // already the new human format
  return `${verb} ${amount} — rebalancing to target mix`;
}

export function isSimulated(reason: string | null | undefined): boolean {
  return !!reason?.includes("[SIMULATED]");
}
