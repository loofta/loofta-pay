import { useQuery } from "@tanstack/react-query";

export type DuneTopAsset = {
	key: string;
	symbol: string;
	chain?: string;
	volumeUSD: number;
};

export type DuneStats = {
	totalVolumeUSD: number | null;
	totalSwaps: number | null;
	uniqueUsers7d: number | null;
	topAssetsByVolume: DuneTopAsset[];
};

async function fetchDuneStats(): Promise<DuneStats> {
	const res = await fetch("/api/dune/stats", { cache: "no-store" });
	if (!res.ok) {
		throw new Error(`Failed to fetch Dune stats (${res.status})`);
	}
	return res.json();
}

export function useDuneStats() {
	return useQuery<DuneStats>({
		queryKey: ["dune", "stats"],
		queryFn: fetchDuneStats,
		staleTime: 1000 * 60 * 10, // 10 minutes
		retry: 1,
	});
}


