import { useQuery } from "@tanstack/react-query";
import { fetchTokens, type NearToken } from "@/services/nearIntents";

export function useTokensQuery() {
	return useQuery<NearToken[]>({
		queryKey: ["tokens", "all"],
		queryFn: () => fetchTokens(),
		// 4h caching configured in QueryClient defaults; keep explicit here for clarity
		staleTime: 4 * 60 * 60 * 1000,
		gcTime: 4 * 60 * 60 * 1000,
		refetchOnWindowFocus: false,
		refetchOnMount: false,
		refetchOnReconnect: true,
	});
}


