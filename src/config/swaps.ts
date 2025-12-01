export const SWAP_PREFERS_EXACT_OUTPUT: boolean = String((process as any)?.env?.NEXT_PUBLIC_SWAP_PREFERS_EXACT_OUTPUT ?? "true").toLowerCase() !== "false";
export const DEFAULT_SLIPPAGE_BPS: number = Number((process as any)?.env?.NEXT_PUBLIC_DEFAULT_SLIPPAGE_BPS ?? 100);
export const DEFAULT_DEADLINE_SECONDS: number = Number((process as any)?.env?.NEXT_PUBLIC_DEFAULT_DEADLINE_SECONDS ?? 180);

// Helper to parse boolean env flags safely
export function envFlag(name: string, defaultValue: boolean = false): boolean {
	const raw = (process as any)?.env?.[name];
	if (raw == null) return defaultValue;
	const v = String(raw).trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}


