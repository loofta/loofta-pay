"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import React from "react";

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const appId = (process as any)?.env?.NEXT_PUBLIC_PRIVY_APP_ID || "";
	return (
		<PrivyProvider
			appId={appId}
			config={{
				loginMethods: ["email"],
				session: { duration: 7 * 24 * 60 * 60 },
			}}
		>
			{children}
		</PrivyProvider>
	);
}
