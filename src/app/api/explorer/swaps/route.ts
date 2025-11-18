import { NextRequest, NextResponse } from "next/server";

const BASE = "https://explorer.near-intents.org/api/v0";

export async function GET(req: NextRequest) {
	const url = new URL(req.url);
	const referral = url.searchParams.get("referral") || "looftaswap";
	const page = url.searchParams.get("page") || "1";
	const pageSize = url.searchParams.get("page_size") || "25";
	const status = url.searchParams.get("status") || ""; // optional
	const symbolIn = url.searchParams.get("symbol_in") || "";
	const symbolOut = url.searchParams.get("symbol_out") || "";
	const start = url.searchParams.get("start") || ""; // ISO
	const end = url.searchParams.get("end") || ""; // ISO

	const token = process.env.EXPLORER_API_JWT || process.env.NEXT_PUBLIC_EXPLORER_JWT;
	if (!token) {
		return NextResponse.json({ error: "Missing EXPLORER_API_JWT env" }, { status: 500 });
	}

	const params = new URLSearchParams();
	params.set("referral", referral);
	params.set("page", page);
	params.set("page_size", pageSize);
	if (status) params.set("status", status);
	if (symbolIn) params.set("symbol_in", symbolIn);
	if (symbolOut) params.set("symbol_out", symbolOut);
	if (start) params.set("start", start);
	if (end) params.set("end", end);

	const target = `${BASE}/transactions-pages?${params.toString()}`;
	try {
		const res = await fetch(target, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			},
			cache: "no-store",
		});
		const data = await res.json();
		return NextResponse.json(data, { status: res.status });
	} catch (e: any) {
		return NextResponse.json({ error: e?.message || "Failed to fetch explorer data" }, { status: 500 });
	}
}
