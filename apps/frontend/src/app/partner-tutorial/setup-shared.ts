/** The example partner in the tutorial. Fixed on purpose, so the tutorial always plays the same. */
export const LOGOS = [
  { id: "ring", color: "ea580c" },
  { id: "bars", color: "2563eb" },
  { id: "spark", color: "7c3aed" },
  { id: "wave", color: "0d9488" },
  { id: "tri", color: "e11d48" },
  { id: "dia", color: "18181b" },
] as const;

export type Setup = { brand: string; logo: string; color: string; fee: number; pct: number; enabled: string[]; showHistory: boolean };

export const SETUP: Setup = { brand: "Acme", logo: "ring", color: "ea580c", fee: 0.25, pct: 1, enabled: ["usdc", "token", "bank", "p2p"], showHistory: true };

/** Same rule as Loofta: flat + percent, never more than 25% of the payout. */
export function feeFor(setup: Pick<Setup, "fee" | "pct">, amount: number): number {
  const raw = setup.fee + (amount * setup.pct) / 100;
  return Math.ceil(Math.min(raw, amount * 0.25) * 100) / 100;
}

export function onColor(hex: string): string {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#09090b" : "#ffffff";
}
