"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import React from "react";

// Reachable Solana RPC: prefer custom URL or Helius; fallback to public (rate-limited).
// Set NEXT_PUBLIC_HELIUS_API_KEY or NEXT_PUBLIC_SOLANA_RPC_URL for reliable mainnet.
const SOLANA_RPC_HTTP =
	process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
	(process.env.NEXT_PUBLIC_HELIUS_API_KEY
		? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
		: "https://api.mainnet-beta.solana.com");
const SOLANA_RPC_WS =
	process.env.NEXT_PUBLIC_SOLANA_WS_URL ||
	(process.env.NEXT_PUBLIC_HELIUS_API_KEY
		? `wss://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
		: "wss://api.mainnet-beta.solana.com");

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
	return (
		<PrivyProvider
			appId={appId}
			config={{
				// Email and Twitter for login and linking; encourage two methods for recovery.
				// If you see "Login with Twitter not allowed", enable Twitter in the Privy Dashboard:
				// https://dashboard.privy.io → your app → Login Methods → Socials → enable Twitter/X.
				loginMethods: ["email", "twitter"],
				embeddedWallets: {
					// Don't create EVM wallets - only Solana
					ethereum: {
						createOnLogin: "off", // Explicitly disable EVM wallet creation
					},
					solana: {
						createOnLogin: "all-users", // Create Solana wallet for all users on login
					},
				},
				// Solana RPC clients required for Privy to send transactions and show balances in modals.
				// Use Helius or a custom RPC (env) for reachable endpoints; public RPC is rate-limited.
				solana: {
					rpcs: {
						"solana:mainnet": {
							rpc: createSolanaRpc(SOLANA_RPC_HTTP),
							rpcSubscriptions: createSolanaRpcSubscriptions(SOLANA_RPC_WS),
						},
					},
				},
				// Detect external Solana wallets (e.g. Phantom) for "Pay with wallet" and connection flows.
				externalWallets: {
					solana: {
						connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }),
					},
				},
				appearance: {
					theme: "light",
					logo: "/loofta.svg",
					accentColor: "#FF0F00",
					showWalletLoginFirst: false,
					walletChainType: "solana-only",
				},
			}}
		>
			{children}
		</PrivyProvider>
	);
}
