/**
 * One place that turns a stored trade `reason` into user-facing words. New rows are already
 * human ("Added $3.10 — attention rising"); older rows carry the engine's raw format
 * ("rebalance: elfa score 0.41, buy $7.25", "no Elfa signal yet") and are translated here so the
 * provider name and raw scores never reach the screen.
 */
export function humanizeReason(reason: string | null | undefined, side: "buy" | "sell", usdValue: number): string {
  const amount = `$${Math.abs(usdValue).toFixed(2)}`;
  const verb = side === "buy" ? "Added" : "Trimmed";
  const raw = (reason ?? "").replace("[SIMULATED] ", "").trim();
  if (!raw) return `${verb} ${amount}`;
  if (!/^rebalance:/i.test(raw)) return raw; // already the new human format

  const scoreMatch = raw.match(/score\s+(-?\d+(?:\.\d+)?)/i);
  const noSignal = /no .*signal/i.test(raw);
  let why: string;
  if (noSignal || !scoreMatch) {
    why = side === "buy" ? "starting position, no attention signal yet" : "rebalancing to target, no attention signal yet";
  } else {
    const score = Number(scoreMatch[1]);
    why = score >= 0.15 ? "attention rising" : score <= -0.15 ? "attention cooling" : "steady attention, rebalancing to target";
  }
  return `${verb} ${amount} — ${why}`;
}

export function isSimulated(reason: string | null | undefined): boolean {
  return !!reason?.includes("[SIMULATED]");
}
