import { useQuery } from "@tanstack/react-query";
import { getAmpleStats } from "@/services/api/ample";

/** Public staking numbers (no sign-in needed). Cached so the home card and /stake share one request. */
export function useAmpleStats() {
  return useQuery({ queryKey: ["ample-stats"], queryFn: getAmpleStats, staleTime: 120_000, retry: 1 });
}

/** Base units string -> display number string. String math so large balances never lose precision. */
export function fromBase(raw: string | number | undefined | null, decimals: number): string {
  if (raw === undefined || raw === null || raw === "") return "0";
  const s = String(raw).replace(/\D/g, "").padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "").slice(0, 4);
  return frac ? `${whole}.${frac}` : whole;
}

export function compactUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)}%`;
}
