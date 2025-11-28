export function trimDecimals(value: string | number, maxDecimals: number = 5): string {
	const s = String(value ?? "");
	if (!s || isNaN(Number(s))) return "0";
	const [intPart, frac = ""] = s.split(".");
	if (maxDecimals <= 0 || frac.length === 0) return intPart;
	const trimmed = frac.slice(0, Math.max(0, maxDecimals)).replace(/0+$/, "");
	return trimmed ? `${intPart}.${trimmed}` : intPart;
}

export function maskLink(link: string): string {
	try {
		const url = new URL(link);
		const host = url.host;
		const path = url.pathname || "";
		const tail = path.replace(/\/+$/, "").split("/").pop() || "";
		const last4 = tail.slice(-4);
		return `${host}/...${last4}`;
	} catch {
		const last4 = (link || "").slice(-4);
		return `...${last4}`;
	}
}

export function roundUpDecimals(value: string | number, decimals: number): string {
	const n = Number(value);
	if (!Number.isFinite(n)) return String(value);
	const factor = Math.pow(10, Math.max(0, decimals));
	const up = Math.ceil(n * factor) / factor;
	// Ensure fixed decimals, then trim trailing zeros
	return up.toFixed(decimals).replace(/\.?0+$/, (m) => (decimals === 0 ? "" : m));
}


