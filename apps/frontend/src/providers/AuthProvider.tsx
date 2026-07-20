"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors, useSolanaFundingPlugin } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import React from "react";

function SolanaPlugins() {
  useSolanaFundingPlugin();
  return null;
}

import { getSolanaCluster, getSolanaHttpRpc, getSolanaWsRpc } from "@/lib/solanaCluster";

const cluster = getSolanaCluster();

/** Mainnet HTTP RPC for Privy `solana:mainnet` (when app cluster is mainnet, uses same URL as rest of app). */
const SOLANA_RPC_HTTP_MAINNET =
	cluster === "mainnet-beta"
		? getSolanaHttpRpc()
		: process.env.NEXT_PUBLIC_HELIUS_API_KEY
			? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
			: "https://api.mainnet-beta.solana.com";
const SOLANA_RPC_WS_MAINNET =
	cluster === "mainnet-beta"
		? getSolanaWsRpc()
		: process.env.NEXT_PUBLIC_HELIUS_API_KEY
			? `wss://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
			: "wss://api.mainnet-beta.solana.com";

/** Devnet HTTP RPC for Privy `solana:devnet` (when app cluster is devnet, uses NEXT_PUBLIC_SOLANA_RPC_URL or public devnet). */
const SOLANA_RPC_HTTP_DEVNET =
	cluster === "devnet" ? getSolanaHttpRpc() : "https://api.devnet.solana.com";
const SOLANA_RPC_WS_DEVNET = cluster === "devnet" ? getSolanaWsRpc() : "wss://api.devnet.solana.com";

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
	return (
		<PrivyProvider
			appId={appId}
			config={{
				// Email/Twitter/Discord/GitHub/Telegram for login and linking; encourage two methods
				// for recovery. If you see "Login with X not allowed", enable that method in the
				// Privy Dashboard: https://dashboard.privy.io → your app → Login Methods → enable it.
				// Telegram is included here (not just per-call on the relay page) because Privy only
				// allows one PrivyProvider per app — a login method has to be declared here to be
				// usable via login({loginMethods:["telegram"]}) anywhere, including on the loofta.com
				// relay (see telegram-relay/page.tsx), which means it also shows up in the default
				// sign-in modal everywhere else. Telegram's widget itself still only works on
				// loofta.com/www.loofta.com, not this (.xyz) app domain — see TELEGRAM_SEND_ENABLED
				// in lib/socialPlatforms.ts for the separate flag gating it from send/edit pickers.
				loginMethods: ["email", "twitter", "discord", "github", "telegram"],
				embeddedWallets: {
					// Create EVM (Base) wallets for users who don't have one yet.
					// Needed for non-custodial peer offramp (ZKP2P on Base).
					ethereum: {
						createOnLogin: "users-without-wallets",
					},
					solana: {
						createOnLogin: "users-without-wallets",
					},
					// Disable Privy's signing confirmation modal — app drives its own UX.
					showWalletUIs: false,
				},
				// Solana RPC clients required for Privy to send transactions and show balances in modals.
				// Use Helius or a custom RPC (env) for reachable endpoints; public RPC is rate-limited.
				solana: {
					rpcs: {
						"solana:mainnet": {
							rpc: createSolanaRpc(SOLANA_RPC_HTTP_MAINNET),
							rpcSubscriptions: createSolanaRpcSubscriptions(SOLANA_RPC_WS_MAINNET),
						},
						"solana:devnet": {
							rpc: createSolanaRpc(SOLANA_RPC_HTTP_DEVNET),
							rpcSubscriptions: createSolanaRpcSubscriptions(SOLANA_RPC_WS_DEVNET),
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
			<SolanaPlugins />
			{children}
		</PrivyProvider>
	);
}
