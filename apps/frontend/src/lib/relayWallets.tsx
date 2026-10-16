"use client";

/**
 * Shared Relay (relay.link) wallet-connect infra: the provider tree and non-EVM `AdaptedWallet`
 * adapters needed to let a connected EVM/TON/Bitcoin wallet fund a Relay quote directly, instead of
 * a manual refund-address + generated-deposit-address flow. Originally built inline in
 * RelayWalletCheckout.tsx (guest checkout's former "Any token" option, since replaced by
 * NearIntentsCheckoutOption.tsx); extracted here so BalanceModal's top-up panel
 * (RelayTopUpPanel.tsx) can reuse the exact same wallet-connect stack rather than duplicating it —
 * and so NearIntentsCheckoutOption.tsx can reuse it too, purely for its wallet-connect UI (none of
 * Relay's own quote/execute machinery).
 */

import { useMemo } from "react";
import type { Chain } from "viem";
import { WagmiProvider } from "wagmi";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@relayprotocol/relay-kit-ui/styles.css";
import { RelayKitProvider } from "@relayprotocol/relay-kit-ui";
import { useRelayChains } from "@relayprotocol/relay-kit-hooks";
import type { AdaptedWallet, RelayChain } from "@relayprotocol/relay-sdk";
import { TonConnectUIProvider, type TonConnectUI } from "@tonconnect/ui-react";
import { request as satsConnectRequest } from "sats-connect";
import { Loader2 } from "lucide-react";

export const SOLANA_CHAIN_ID = 792703809;
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const TON_CHAIN_ID = 224235520;
// Relay's own chain id for its Bitcoin ("bvm") VM — not exported from relay-kit-ui's public entry
// point (only from an internal utils path), so hardcoded here the same way TON_CHAIN_ID already is.
export const BITCOIN_CHAIN_ID = 8253038;

// TON isn't EVM — wagmi/RainbowKit can't connect a TON wallet at all, so it needs its own,
// completely separate wallet-connect stack (TonConnect) alongside the EVM one, not a config flag
// on the existing setup. Relay's own `AdaptedWallet` interface is VM-agnostic by design (see
// relay-sdk's TonReceipt type), so once this adapter satisfies it, useQuote/executeQuote treat a
// TON payment exactly like an EVM one — same quote shape, same execute call, same settlement path.
export function createTonAdaptedWallet(tonConnectUI: TonConnectUI, address: string): AdaptedWallet {
  return {
    vmType: "tonvm",
    getChainId: async () => TON_CHAIN_ID,
    address: async () => address,
    // TonConnect only ever targets TON itself (mainnet, in this app's case) — there's no other
    // chain to switch to, unlike an EVM wallet that might need a network switch prompt.
    switchChain: async () => {},
    handleSignMessageStep: async () => undefined,
    handleSendTransactionStep: async (_chainId, item) => {
      const messages = item.data.messages || [];
      if (messages.length === 0) throw new Error("No TON transaction to send");
      const result = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: messages.map((m) => ({
          address: m.to,
          amount: m.value,
          payload: m.body,
          stateInit: m.stateInit,
        })),
      });
      return result.boc;
    },
    // Real confirmation for this payment never depends on this — settlement is always confirmed
    // by polling the destination balance directly, same as every other funding method.
    handleConfirmTransactionStep: async (tx) => ({ hash: tx }),
  };
}

// Bitcoin isn't EVM or TON either — Relay treats it as its own VM ("bvm"), with an unsigned PSBT
// (item.data.psbt) in place of TON's `messages` or EVM's raw tx. There is no reference
// implementation for this anywhere — not in Relay's docs, changelog, or previously in this repo —
// so this is built directly from relay-sdk's AdaptedWallet/TransactionStepItem types (confirmed:
// `BitcoinWalletMetadata.publicKey`, `TransactionStepItem.data.psbt?: string`) and sats-connect's
// unified wallet-standard `request()` API (confirmed: `signPsbt` takes `{psbt, broadcast}` and
// returns `{psbt, txid?}`). UNVERIFIED — needs real hands-on testing with an actual Bitcoin wallet
// extension (Xverse/Unisat/Leather) before this is trusted with real funds.
export function createBitcoinAdaptedWallet(address: string, publicKey: string): AdaptedWallet {
  return {
    vmType: "bvm",
    metadata: { publicKey },
    getChainId: async () => BITCOIN_CHAIN_ID,
    address: async () => address,
    switchChain: async () => {},
    handleSignMessageStep: async () => undefined,
    handleSendTransactionStep: async (_chainId, item) => {
      const psbt = item.data.psbt;
      if (!psbt) throw new Error("No Bitcoin PSBT to sign");
      const response = await satsConnectRequest("signPsbt", { psbt, broadcast: true });
      if (response.status === "error") throw new Error(response.error.message);
      return response.result.txid ?? response.result.psbt;
    },
    handleConfirmTransactionStep: async (tx) => ({ hash: tx }),
  };
}

// Isolated from the app's root QueryClient (src/providers/QueryProvider.tsx) — Relay's hooks need
// their own, and there's no value in sharing caches between wagmi/Relay's queries and the rest of
// the app's. Shared by every consumer of DynamicWalletProviders rather than one per mount, since
// they're never expected to be mounted concurrently.
export const relayQueryClient = new QueryClient();

// wagmi/RainbowKit need a fixed chains list up front to know what a connected wallet can be
// switched to. A hardcoded handful of "popular" chains was an earlier version of this — it left
// the token picker only ever showing tokens on those few chains, since TokenSelector builds its
// per-chain menu from what the connected wallet's config actually supports, not from Relay's full
// catalog. Fetching Relay's own chain list (useRelayChains' `viemChains`, ready-made viem Chain
// objects for every EVM chain Relay supports) and building the wagmi config from THAT instead means
// "all chains Relay supports" and "all chains this wallet-connect flow offers" stay the same set,
// without hand-maintaining a duplicate list here.
function DynamicWalletProvidersInner({ children }: { children: React.ReactNode }) {
  // `viemChains` (alongside `data`/`chains`, not nested inside `data`) is the ENRICHED chain list
  // narrowed to only entries with a real viem `Chain` object — i.e. EVM chains only, since viem
  // itself is EVM-specific. That's exactly right for wagmi's config, but it must never be reused
  // as RelayKitProvider's own `options.chains` — that silently excludes every non-EVM chain (TON,
  // Solana, Bitcoin, Tron, ...). And leaving `options.chains` unset entirely isn't the fix either:
  // per the SDK's own RelayClientOptions docs, an unset `chains` defaults to mainnet-only, not
  // "everything" — which is exactly the "only Ethereum" regression from doing that. The actual full
  // catalog is `data.chains` (the plain, unfiltered array the base query returns, no viemChain
  // requirement) — that's what belongs in `options.chains`.
  const { data, isLoading, viemChains } = useRelayChains();

  const wagmiConfig = useMemo(() => {
    const chains = (viemChains || []) as Chain[];
    if (chains.length === 0) return null;
    return getDefaultConfig({
      appName: "Loofta",
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
      chains: chains as unknown as [Chain, ...Chain[]],
      ssr: true,
    });
  }, [viemChains]);

  if (isLoading || !wagmiConfig) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
      </div>
    );
  }

  // /tonconnect-manifest.json is a dynamic route (src/app/tonconnect-manifest.json/route.ts) that
  // reflects whatever origin the request actually came from, so this always matches the current
  // page — required because TonConnect hard-blocks a connection if the manifest's declared `url`
  // doesn't match the page's real origin ("actual domain X is trying to authorise as Y"). Note
  // this still only works for a wallet that can reach this origin at all: a wallet on the same
  // machine (browser extension, Telegram Desktop) can reach localhost fine; a remote wallet
  // scanning a QR code (a phone) can't, regardless of what the manifest says — that's a separate,
  // unavoidable limitation of testing against localhost, not something this fixes.
  const manifestUrl = typeof window !== "undefined" ? `${window.location.origin}/tonconnect-manifest.json` : "https://pay.loofta.com/tonconnect-manifest.json";

  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider>
        <TonConnectUIProvider manifestUrl={manifestUrl}>
          <RelayKitProvider options={{ appName: "Loofta", source: "loofta.com", chains: data?.chains as RelayChain[] | undefined }}>
            {children}
          </RelayKitProvider>
        </TonConnectUIProvider>
      </RainbowKitProvider>
    </WagmiProvider>
  );
}

// Mounts wagmi/RainbowKit/TonConnect/Relay's own QueryClient — deliberately NOT mounted at the app
// root (the rest of the app manages wallets through Privy and has no reason to carry this weight).
// Callers should only render this when the wallet-connect panel is actually open.
export function DynamicWalletProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={relayQueryClient}>
      <DynamicWalletProvidersInner>{children}</DynamicWalletProvidersInner>
    </QueryClientProvider>
  );
}
