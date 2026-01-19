import { useQuery } from "@tanstack/react-query";
import { getExecutionStatus } from "@/services/nearIntents";

export type IntentStatus = {
	status?: "PENDING" | "SUCCESS" | "REFUNDED" | string;
	updatedAt?: string;
	transactionHash?: string;
	payoutTxHash?: string;
	[p: string]: any;
};

export function useIntentStatus(depositAddress?: string) {
	return useQuery<IntentStatus, Error>({
		queryKey: ["intentStatus", depositAddress],
		queryFn: async () => {
			if (!depositAddress) throw new Error("No deposit address");
			const r = await getExecutionStatus(depositAddress);
			return r as IntentStatus;
		},
		enabled: !!depositAddress,
		refetchInterval: (data) => {
			const s = (data as any)?.status;
			// Stop polling on terminal states
			if (s === "SUCCESS" || s === "REFUNDED") return false;
			return 5000; // 5s
		},
		staleTime: 0,
		gcTime: 1000 * 60 * 10,
		retry: 1,
	});
}
