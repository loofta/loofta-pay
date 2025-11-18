"use client";

import { useQuery } from "@tanstack/react-query";
import { getLocalHistory, type SwapHistoryItem } from "@/lib/history";

export function useHistoryQuery(_userId?: string) {
	const initial = getLocalHistory();
	return useQuery<SwapHistoryItem[], Error>({
		queryKey: ["history", "local"],
		queryFn: async () => getLocalHistory().sort((a,b) => b.createdAt - a.createdAt),
		initialData: initial.sort((a,b) => b.createdAt - a.createdAt),
		refetchInterval: 10000,
		staleTime: 5000,
		gcTime: 1000 * 60 * 10,
	});
}
