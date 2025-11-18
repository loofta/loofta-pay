'use client'

import { PropsWithChildren, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: PropsWithChildren) {
	const [client] = useState(() => new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 4 * 60 * 60 * 1000, // 4 hours
				gcTime: 4 * 60 * 60 * 1000, // 4 hours
				refetchOnWindowFocus: false,
				refetchOnMount: false,
				refetchOnReconnect: true,
				retry: 1,
			},
		},
	}));
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}


