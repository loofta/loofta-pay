"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import React from "react";

const isDevnet = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet";
const mainnetRpc =
  process.env.NEXT_PUBLIC_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com";

/**
 * Privy config for the Link claim app, deliberately different from the main app's
 * (apps/frontend/src/providers/AuthProvider.tsx) in one key way: embeddedWallets are OFF here.
 * The whole point of this app is that a recipient claims straight to an EXTERNAL wallet they
 * paste or connect — never a Loofta-managed embedded wallet — so there's no reason to ever
 * provision one. Login methods match the main app's identity-verification set (see
 * users.service.ts verifyRecipientIdentityForSendPayment) since claiming still goes through the
 * exact same server-side identity check; Telegram is intentionally excluded here for now since
 * it requires the loofta.com relay-domain workaround, which isn't wired to this app yet.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "twitter", "discord", "github"],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
          showWalletUIs: false,
        },
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }),
          },
        },
        appearance: {
          walletChainType: "solana-only",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

/** Exported for the claim page's fetch calls — kept in one place so RPC choice stays consistent. */
export const SOLANA_RPC_URL = isDevnet ? "https://api.devnet.solana.com" : mainnetRpc;
export const IS_DEVNET = isDevnet;
