import { NextResponse } from "next/server";

// Use dynamic import to avoid bundling the SDK on the client
async function getDuneClient(apiKey: string) {
	const mod = await import("@duneanalytics/client-sdk");
	// eslint-disable-next-line new-cap
	return new mod.DuneClient(apiKey);
}

type AnyRow = Record<string, any>;

function extractFirstNumber(row: AnyRow): number | undefined {
	for (const v of Object.values(row)) {
		if (typeof v === "number") return v;
		if (typeof v === "string") {
			const num = Number(v);
			if (!Number.isNaN(num)) return num;
		}
	}
	return undefined;
}

function pickNumberByKeys(row: AnyRow, keys: string[]): number | undefined {
	for (const k of keys) {
		const v = row[k];
		if (typeof v === "number") return v;
		if (typeof v === "string") {
			const num = Number(v);
			if (!Number.isNaN(num)) return num;
		}
	}
	return undefined;
}

function safeNumber(n: any): number | undefined {
	if (typeof n === "number") return n;
	if (typeof n === "string") {
		const num = Number(n);
		if (!Number.isNaN(num)) return num;
	}
	return undefined;
}

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const apiKey =
			process.env.DUNE_API_KEY ||
			process.env.NEXT_PUBLIC_DUNE_API_KEY ||
			"83kaZRxycD2dj99tLORDCpwS3f6P27My";
		const dune = await getDuneClient(apiKey);

		// Query IDs provided by user
		const totalVolumeQueryId = 5179085;
		const totalSwapsQueryId = 5175192;
		const volumeByAssetsQueryId = 5175131;

		const [totalVolRes, totalSwapsRes, byAssetsRes, uniqueUsers7dRes] = await Promise.all([
			dune.getLatestResult({ queryId: totalVolumeQueryId }),
			dune.getLatestResult({ queryId: totalSwapsQueryId }),
			dune.getLatestResult({ queryId: volumeByAssetsQueryId }),
			dune.getLatestResult({ queryId: 5180328 }),
		]);

		const totalVolRows: AnyRow[] = totalVolRes?.result?.rows || [];
		const totalSwapsRows: AnyRow[] = totalSwapsRes?.result?.rows || [];
		const byAssetsRows: AnyRow[] = byAssetsRes?.result?.rows || [];
		const uniqueUsersRows: AnyRow[] = uniqueUsers7dRes?.result?.rows || [];

		let totalVolumeUSD: number | undefined;
		if (totalVolRows.length > 0) {
			totalVolumeUSD =
				pickNumberByKeys(totalVolRows[0], ["total_volume_usd", "total_volume", "volume_usd", "usd"]) ??
				extractFirstNumber(totalVolRows[0]);
		}

		let totalSwaps: number | undefined;
		if (totalSwapsRows.length > 0) {
			totalSwaps =
				pickNumberByKeys(totalSwapsRows[0], ["total_swaps", "swaps", "count"]) ??
				Math.round(extractFirstNumber(totalSwapsRows[0]) || 0);
		}
		let uniqueUsers7d: number | undefined;
		if (uniqueUsersRows.length > 0) {
			uniqueUsers7d =
				pickNumberByKeys(uniqueUsersRows[0], ["unique_users", "users", "unique", "count"]) ??
				Math.round(extractFirstNumber(uniqueUsersRows[0]) || 0);
		}

		// Expect rows shaped like: { asset: 'USDT', chain: 'eth', volume_usd: 12345 }
		// We'll group per asset symbol (optionally include chain if present), and sum USD
		type AssetVol = { key: string; symbol: string; chain?: string; volumeUSD: number };
		const vols: Record<string, AssetVol> = {};
		for (const r of byAssetsRows) {
			const symbol: string =
				(String(r.symbol || r.asset || r.token || "")).toUpperCase();
			const chain: string | undefined = r.chain ? String(r.chain) : undefined;
			const vol =
				pickNumberByKeys(r, ["volume_usd", "usd", "volume"]) ??
				extractFirstNumber(r) ??
				0;
			const key = chain ? `${symbol}:${chain}` : symbol;
			if (!vols[key]) {
				vols[key] = { key, symbol, chain, volumeUSD: 0 };
			}
			vols[key].volumeUSD += safeNumber(vol) || 0;
		}
		const topAssetsByVolume = Object.values(vols)
			.sort((a, b) => b.volumeUSD - a.volumeUSD)
			.slice(0, 10);

		return NextResponse.json(
			{
				totalVolumeUSD: totalVolumeUSD ?? null,
				totalSwaps: totalSwaps ?? null,
				uniqueUsers7d: uniqueUsers7d ?? null,
				topAssetsByVolume,
				// Placeholders for future: 24h/7D/30D volumes could be added via additional queries
			},
			{ status: 200 }
		);
	} catch (e: any) {
		return NextResponse.json(
			{ error: e?.message || "Failed to fetch Dune analytics" },
			{ status: 500 }
		);
	}
}


