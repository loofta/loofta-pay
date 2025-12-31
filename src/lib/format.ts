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

/**
 * Format a UTC timestamp string to local timezone
 * Ensures the timestamp is treated as UTC even if it doesn't have a 'Z' suffix
 */
export function formatUTCTimestamp(utcTimestamp: string | null | undefined): string {
	if (!utcTimestamp) return "";
	
	// Ensure the timestamp is treated as UTC
	// If it doesn't end with 'Z' or have a timezone offset, append 'Z' to indicate UTC
	let timestampStr = utcTimestamp.trim();
	if (!timestampStr.endsWith('Z') && !timestampStr.match(/[+-]\d{2}:\d{2}$/)) {
		// If it's in ISO format without timezone, append 'Z' to indicate UTC
		if (timestampStr.includes('T')) {
			timestampStr = timestampStr + 'Z';
		}
	}
	
	const date = new Date(timestampStr);
	
	// Check if date is valid
	if (isNaN(date.getTime())) {
		console.warn('Invalid timestamp:', utcTimestamp);
		return utcTimestamp;
	}
	
	// Convert to local timezone
	return date.toLocaleString();
}


