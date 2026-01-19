"use client";

import { useQuery } from "@tanstack/react-query";

export type ExplorerFilters = {
	referral?: string;
	page?: number;
	pageSize?: number;
	status?: string; // SUCCESS|REFUNDED|FAILED|... optional
	symbolIn?: string;
	symbolOut?: string;
	start?: string; // ISO string
	end?: string;   // ISO string
};

export function useExplorerSwaps(filters: ExplorerFilters) {
	const params = new URLSearchParams();
	if (filters.referral) params.set("referral", filters.referral);
	if (filters.page) params.set("page", String(filters.page));
	if (filters.pageSize) params.set("page_size", String(filters.pageSize));
	if (filters.status) params.set("status", filters.status);
	if (filters.symbolIn) params.set("symbol_in", filters.symbolIn);
	if (filters.symbolOut) params.set("symbol_out", filters.symbolOut);
	if (filters.start) params.set("start", filters.start);
	if (filters.end) params.set("end", filters.end);

	return useQuery<any, Error>({
		queryKey: ["explorerSwaps", Object.fromEntries(params)],
		queryFn: async () => {
			const res = await fetch(`/api/explorer/swaps?${params.toString()}`);
			if (!res.ok) throw new Error("Failed to fetch explorer swaps");
			return res.json();
		},
		staleTime: 15_000,
		gcTime: 60_000,
	});
}
