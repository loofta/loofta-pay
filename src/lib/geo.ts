"use client";

let cached: { ip?: string; country?: string; countryCode?: string } | null = null;

export async function getClientGeo(): Promise<{ ip?: string; country?: string; countryCode?: string }> {
	if (cached) return cached;
	try {
		const raw = localStorage.getItem("loofta.geo");
		if (raw) {
			cached = JSON.parse(raw);
			return cached || {};
		}
	} catch {}
	try {
		const res = await fetch("https://ipapi.co/json/");
		if (!res.ok) throw new Error("geo failed");
		const j = await res.json();
		cached = { ip: j.ip, country: j.country_name, countryCode: j.country_code };
		try { localStorage.setItem("loofta.geo", JSON.stringify(cached)); } catch {}
		return cached;
	} catch {
		cached = {};
		return {};
	}
}
