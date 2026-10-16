"use client";

/**
 * Guest checkout's "Any token" option: connect any EVM wallet, pick a token/chain to pay from,
 * and route it cross-chain into this payment link's own Solana USDC burner via Relay
 * (relay.link). Not Relay's pre-built SwapWidget — that's a two-sided swap UI (pick a "from" and
 * a "to"), and it also forces a wallet-connect screen before you can even see the token/chain
 * picker. Here the destination (USDC on this burner, Solana) is fixed and abstracted away
 * entirely; the only thing the payer ever picks is what they're paying WITH, and they pick that
 * — token AND chain — before connecting a wallet, since which wallet they need depends on which
 * chain they choose, not the other way around. The picker itself is Relay's own `TokenSelector`
 * (from relay-kit-ui — its real cross-chain token list, search, and chain filtering, not a
 * hand-rolled one) behind a custom trigger button; everything around it (the tile, the amount
 * card, the pay button) is this checkout's own styling, not Relay's widget chrome. Quoting/paying
 * uses relay-kit-hooks' useQuote directly, and useRelayChains just for chain display names.
 * An earlier version of this built its own token list from useTokenList — that came back empty in
 * practice (the raw currency data doesn't reliably carry usable chain/logo info on its own), so
 * TokenSelector's own internal fetching replaced it instead of debugging that further.
 *
 * No refund-address field, unlike the earlier deposit-address approach this replaced: a connected
 * wallet is both the funding source and the natural refund destination if a step reverts, so
 * there's nothing extra to collect. `useQuote`'s `recipient` (the burner) is set independently
 * from `user` (the connected wallet) — the quote represents "this wallet pays, that address
 * receives," not a same-wallet swap.
 *
 * The provider tree here (WagmiProvider/RainbowKitProvider/RelayKitProvider) is mounted locally,
 * scoped to just this component's subtree, not the app root — the rest of the app manages
 * wallets through Privy and has no reason to carry wagmi/RainbowKit's weight.
 */

import { useMemo, useState } from "react";
import type { Chain } from "viem";
import { WagmiProvider, useAccount, useWalletClient } from "wagmi";
import { getDefaultConfig, RainbowKitProvider, useConnectModal } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@relayprotocol/relay-kit-ui/styles.css";
import { RelayKitProvider, useRelayClient, TokenSelector, type Token } from "@relayprotocol/relay-kit-ui";
import { useQuote, useRelayChains } from "@relayprotocol/relay-kit-hooks";
import type { AdaptedWallet, RelayChain } from "@relayprotocol/relay-sdk";
import { TonConnectUIProvider, useTonConnectUI, useTonAddress, useTonWallet, type TonConnectUI } from "@tonconnect/ui-react";
import { ChevronDown, Loader2, Globe, LogIn } from "lucide-react";

const SOLANA_CHAIN_ID = 792703809;
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TON_CHAIN_ID = 224235520;

// TON isn't EVM — wagmi/RainbowKit can't connect a TON wallet at all, so it needs its own,
// completely separate wallet-connect stack (TonConnect) alongside the EVM one, not a config flag
// on the existing setup. Relay's own `AdaptedWallet` interface is VM-agnostic by design (see
// relay-sdk's TonReceipt type), so once this adapter satisfies it, useQuote/executeQuote treat a
// TON payment exactly like an EVM one — same quote shape, same execute call, same settlement path.
function createTonAdaptedWallet(tonConnectUI: TonConnectUI, address: string): AdaptedWallet {
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
    // by polling the claim's own burner balance (pollUntilSettled), the same as every other
    // guest payment method here, regardless of what chain/VM actually funded it.
    handleConfirmTransactionStep: async (tx) => ({ hash: tx }),
  };
}

// Isolated from the app's root QueryClient (src/providers/QueryProvider.tsx) — Relay's hooks need
// their own, and there's no value in sharing caches between wagmi/Relay's queries and the rest of
// the app's.
const relayQueryClient = new QueryClient();

// wagmi/RainbowKit need a fixed chains list up front to know what a connected wallet can be
// switched to. A hardcoded handful of "popular" chains was the earlier version of this file —
// it left the token picker only ever showing tokens on those few chains, since TokenSelector
// builds its per-chain menu from what the connected wallet's config actually supports, not from
// Relay's full catalog. Fetching Relay's own chain list (useRelayChains' `viemChains`, ready-made
// viem Chain objects for every EVM chain Relay supports) and building the wagmi config from THAT
// instead means "all chains Relay supports" and "all chains this wallet-connect flow offers" stay
// the same set, without hand-maintaining a duplicate list here.
function DynamicWalletProviders({ children }: { children: React.ReactNode }) {
  // `viemChains` (alongside `data`/`chains`, not nested inside `data`) is the ENRICHED chain list
  // narrowed to only entries with a real viem `Chain` object — i.e. EVM chains only, since viem
  // itself is EVM-specific. That's exactly right for wagmi's config, but it must never be reused
  // as RelayKitProvider's own `options.chains` — that silently excludes every non-EVM chain (TON,
  // Solana, Tron, ...). And leaving `options.chains` unset entirely isn't the fix either: per the
  // SDK's own RelayClientOptions docs, an unset `chains` defaults to mainnet-only, not "everything"
  // — which is exactly the "only Ethereum" regression from doing that. The actual full catalog is
  // `data.chains` (the plain, unfiltered array the base query returns, no viemChain requirement) —
  // that's what belongs in `options.chains`.
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

// Quote amounts come back as raw atomic-division floats (e.g. "5.000000000000001") — round to a
// sane display precision and drop trailing zeros rather than showing the full float noise.
function formatTokenAmount(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toFixed(6).replace(/\.?0+$/, "");
}

function PayPanel({
  burnerAddress,
  amountUsd,
  onSettled,
  setError,
  pollUntilSettled,
  claimId,
  email,
}: {
  burnerAddress: string;
  amountUsd: number;
  onSettled: () => void;
  setError: (e: string | null) => void;
  pollUntilSettled: (claimId: string, email: string, txHash: string | undefined, shouldAbort: () => boolean) => Promise<boolean>;
  claimId: string;
  email: string;
}) {
  const { address: evmAddress } = useAccount();
  const { data: evmWalletClient } = useWalletClient();
  const { openConnectModal } = useConnectModal();
  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const tonAddress = useTonAddress();
  const relayClient = useRelayClient();

  const { data: chainsData } = useRelayChains();
  const chainNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of chainsData?.chains || []) {
      if (c?.id != null) m.set(c.id, c.displayName || String(c.id));
    }
    return m;
  }, [chainsData]);

  const [selectedToken, setSelectedToken] = useState<Token | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  const isTon = selectedToken?.chainId === TON_CHAIN_ID;
  const connectedAddress = isTon ? (tonAddress || undefined) : evmAddress;
  const wallet = isTon
    ? (tonWallet && tonAddress ? createTonAdaptedWallet(tonConnectUI, tonAddress) : undefined)
    : evmWalletClient;

  const atomicOut = useMemo(() => {
    const [i, f = ""] = amountUsd.toFixed(6).split(".");
    return BigInt((i || "0") + f.padEnd(6, "0")).toString();
  }, [amountUsd]);

  const { data: quote, isLoading: quoteLoading, executeQuote } = useQuote(
    relayClient ?? undefined,
    wallet ?? undefined,
    selectedToken && connectedAddress
      ? {
          user: connectedAddress,
          recipient: burnerAddress,
          originChainId: selectedToken.chainId,
          originCurrency: selectedToken.address,
          destinationChainId: SOLANA_CHAIN_ID,
          destinationCurrency: SOLANA_USDC_MINT,
          tradeType: "EXACT_OUTPUT",
          amount: atomicOut,
        }
      : undefined,
    undefined,
    undefined,
    { enabled: !!(selectedToken && connectedAddress && relayClient && wallet) },
  );

  const requiredAmount = quote?.details?.currencyIn?.amountFormatted;

  const handlePay = async () => {
    if (!executeQuote) return;
    setSubmitting(true);
    setError(null);
    setProgressLabel("Waiting for signature…");
    try {
      await executeQuote((progress) => {
        const step = progress.currentStep?.action;
        if (step) setProgressLabel(step);
      });
      setProgressLabel(null);
      setSettling(true);
      const settled = await pollUntilSettled(claimId, email, undefined, () => false);
      setSettling(false);
      if (settled) onSettled();
      else setError("Payment sent, but confirmation is taking longer than expected. Refresh in a moment.");
    } catch (e: any) {
      setError(e?.message || "Payment failed. Please try again.");
    } finally {
      setSubmitting(false);
      setProgressLabel(null);
    }
  };

  if (settling) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
        <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">Waiting for it to arrive…</p>
      </div>
    );
  }

  const selectedChainName = selectedToken ? chainNameById.get(selectedToken.chainId) || `chain ${selectedToken.chainId}` : undefined;

  return (
    <div className="space-y-3">
      <TokenSelector
        token={selectedToken}
        setToken={setSelectedToken}
        context="from"
        supportedWalletVMs={["evm", "tonvm"]}
        trigger={
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-lg bg-white border border-gray-300 px-3 py-2.5 text-base text-gray-900 outline-none focus:border-orange-400 [@media(prefers-color-scheme:dark)]:bg-black/20 [@media(prefers-color-scheme:dark)]:border-white/20 [@media(prefers-color-scheme:dark)]:text-slate-100"
          >
            {selectedToken ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- third-party token logo, not a local/optimizable asset */}
                <img src={selectedToken.logoURI} alt="" className="w-5 h-5 rounded-full shrink-0" />
                <span className="font-medium">{selectedToken.symbol}</span>
                <span className="text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">on {selectedChainName}</span>
              </>
            ) : (
              <span className="text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">Choose a token and network to pay with</span>
            )}
            <ChevronDown className="w-4 h-4 text-gray-400 ml-auto shrink-0" />
          </button>
        }
      />

      {selectedToken && (
        <div className="rounded-lg bg-white border border-gray-200 px-3 py-2 text-center [@media(prefers-color-scheme:dark)]:bg-black/20 [@media(prefers-color-scheme:dark)]:border-white/10">
          {!connectedAddress ? (
            <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">
              Connect a wallet on {selectedChainName} to see the amount.
            </p>
          ) : quoteLoading ? (
            <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400 flex items-center justify-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculating amount…</p>
          ) : requiredAmount ? (
            <>
              <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">Send exactly</p>
              <p className="text-lg font-semibold text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">{formatTokenAmount(requiredAmount)} {selectedToken.symbol}</p>
            </>
          ) : (
            <p className="text-base text-amber-600 [@media(prefers-color-scheme:dark)]:text-amber-400">Couldn&apos;t get a quote for this token — try another.</p>
          )}
        </div>
      )}

      {selectedToken && !connectedAddress && (
        <button
          type="button"
          onClick={() => (isTon ? tonConnectUI.openModal() : openConnectModal?.())}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base border border-gray-300 text-gray-900 hover:bg-gray-50 [@media(prefers-color-scheme:dark)]:border-white/20 [@media(prefers-color-scheme:dark)]:text-slate-100 [@media(prefers-color-scheme:dark)]:hover:bg-white/5"
        >
          <LogIn className="w-4 h-4" /> Connect wallet
        </button>
      )}

      {selectedToken && connectedAddress && (
        <button
          type="button"
          onClick={handlePay}
          disabled={!requiredAmount || submitting}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> {progressLabel || "Processing…"}</> : "Pay"}
        </button>
      )}
    </div>
  );
}

export function RelayAnyTokenOption({
  claimId,
  burnerAddress,
  amountUsd,
  email,
  expanded,
  onToggle,
  onSettled,
  setError,
  pollUntilSettled,
}: {
  claimId: string;
  burnerAddress: string;
  amountUsd: number;
  email: string;
  expanded: boolean;
  onToggle: () => void;
  onSettled: () => void;
  setError: (e: string | null) => void;
  pollUntilSettled: (claimId: string, email: string, txHash: string | undefined, shouldAbort: () => boolean) => Promise<boolean>;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${
          expanded
            ? "border-orange-400 bg-orange-50 [@media(prefers-color-scheme:dark)]:bg-orange-500/10"
            : "border-gray-200 hover:bg-gray-50 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:hover:bg-white/5"
        }`}
      >
        <Globe className="w-8 h-8 text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400" />
        <span className="text-base font-medium text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">Any token</span>
      </button>

      {expanded && (
        <div className="col-span-2 [grid-row:2] rounded-xl border border-gray-200 bg-gray-50 p-4 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:bg-white/5">
          <QueryClientProvider client={relayQueryClient}>
            <DynamicWalletProviders>
              <PayPanel
                claimId={claimId}
                burnerAddress={burnerAddress}
                amountUsd={amountUsd}
                email={email}
                onSettled={onSettled}
                setError={setError}
                pollUntilSettled={pollUntilSettled}
              />
            </DynamicWalletProviders>
          </QueryClientProvider>
        </div>
      )}
    </>
  );
}
