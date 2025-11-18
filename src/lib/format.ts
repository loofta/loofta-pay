export function trimDecimals(value: string | number, maxDecimals: number = 5): string {
	const s = String(value ?? "");
	if (!s || isNaN(Number(s))) return "0";
	const [intPart, frac = ""] = s.split(".");
	if (maxDecimals <= 0 || frac.length === 0) return intPart;
	const trimmed = frac.slice(0, Math.max(0, maxDecimals)).replace(/0+$/, "");
	return trimmed ? `${intPart}.${trimmed}` : intPart;
}


