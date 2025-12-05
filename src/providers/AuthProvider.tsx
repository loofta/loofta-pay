"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import React from "react";

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const appId = (process as any)?.env?.NEXT_PUBLIC_PRIVY_APP_ID || "";
	return (
		<PrivyProvider
			appId={appId}
			config={{
				// Email first for access requests, wallet for payments
				loginMethods: ["email", "wallet"],
				embeddedWallets: { createOnLogin: "users-without-wallets" },
				appearance: {
					theme: "light",
					logo: "/loofta.svg",
					accentColor: "#FF0F00",
					showWalletLoginFirst: false,
				},
			}}
		>
			{children}
		</PrivyProvider>
	);
}
