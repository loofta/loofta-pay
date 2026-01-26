"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import React from "react";

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
	return (
		<PrivyProvider
			appId={appId}
			config={{
				// Email only for login/create account
				loginMethods: ["email"],
				embeddedWallets: { 
					createOnLogin: "all-users", // Create wallet for all users on login
					requireUserPasswordOnCreate: false,
					// Don't create EVM wallets - only Solana
					ethereum: {
						createOnLogin: "off", // Explicitly disable EVM wallet creation
					},
					solana: {
						enabled: true,
						createOnLogin: "all-users", // Create Solana wallet for all users on login
					},
				},
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
