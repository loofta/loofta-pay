"use client";

/**
 * Guest checkout's "Any token" option via NEAR Intents: pick a token/chain with the same
 * TokenCombobox used everywhere else in the app (network list on the side, tokens grouped by
 * symbol), then get a real NEAR Intents deposit address to send funds to — this is a "send to this
 * address" flow (see /api/claims/deposit, the same endpoint the authenticated Pay Now flow in
 * c/[id]/page.tsx already uses), not a client-signed swap tx like the Relay flow this replaces.
 * A backend cron (claim-processor.service.ts) independently watches the created payment_intents
 * row and finalizes the payment once NEAR Intents reports settlement — this component only polls
 * /api/status for UI feedback, it never writes the payment's status itself.
 *
 * Refund address comes from a wallet connection matched to the selected chain's family instead of
 * a manual text field, per lib/refundAddresses.ts's own TODO ("STRICTLY FOR MVP - TO BE REMOVED
 * LATER when wallet connect is implemented"):
 *   - EVM chains  → RainbowKit/wagmi (reuses the same provider tree as the former Relay flow,
 *                    lib/relayWallets.tsx, purely for its wallet-connect UI — none of Relay's
 *                    quote/execute machinery is used here)
 *   - TON         → TonConnect (same stack)
 *   - Bitcoin     → sats-connect's `wallet_connect` (address-only; no tx signing needed here,
 *                    unlike the UNVERIFIED Relay Bitcoin adapter in relayWallets.tsx)
 *   - everything else (Zcash and any other chain without a wallet-connect story here, e.g. XRP,
 *     Cardano, Doge, Litecoin, Sui, Stellar, Tron, Aptos) → manual refund-address input, validated
 *     with isValidAddressForChain before it can be used.
 * Solana is excluded from the token list entirely — UsdcSolanaOption already covers "I have
 * Solana funds" with a plain direct transfer, no swap or refund address needed at all.
 */

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useTonConnectUI, useTonAddress } from "@tonconnect/ui-react";
import { request as satsConnectRequest, AddressPurpose } from "sats-connect";
import { QRCodeSVG } from "qrcode.react";
import { Globe, Loader2, LogIn, Wallet as WalletIcon } from "lucide-react";
import { DynamicWalletProviders } from "@/lib/relayWallets";
import { TokenCombobox } from "@/components/TokenCombobox";
import { TokenIcon } from "@/components/TokenIcon";
import { fetchTokens, type NearToken } from "@/services/nearIntents";
import { findTokenBySelection, formatChainLabel } from "@/lib/tokens";
import { getChainFamily } from "@/lib/chains";
import { isValidAddressForChain, getRefundToForChain } from "@/lib/refundAddresses";
import type { TokenSelection } from "@/app/utils/types";

const STATUS_POLL_MS = 4000;
const STATUS_POLL_TIMEOUT_MS = 20 * 60_000;

type DepositInfo = {
  depositAddress: string;
  memo?: string | null;
  minAmountInFormatted?: string;
  /** Raw atomic amount (e.g. nanotons for TON) in the origin token's own decimals — what an
   *  on-chain transfer instruction actually needs, as opposed to minAmountInFormatted which is
   *  human-readable-only. */
  minAmountIn?: string;
};

function formatAmount(value: string | undefined): string {
  if (!value) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toFixed(6).replace(/\.?0+$/, "");
}

function PayPanel({
  claimId,
  amountUsd,
  email,
  onSettled,
  setError,
}: {
  claimId: string;
  amountUsd: number;
  email: string;
  onSettled: () => void;
  setError: (e: string | null) => void;
}) {
  const [tokens, setTokens] = useState<NearToken[]>([]);
  useEffect(() => {
    fetchTokens().then(setTokens).catch(() => {});
  }, []);

  const [selection, setSelection] = useState<TokenSelection | undefined>(undefined);
  const selectedToken = useMemo(
    () => findTokenBySelection(tokens, selection || null),
    [tokens, selection],
  );
  const chainFamily = selectedToken ? getChainFamily(selectedToken.chain) : undefined;

  // Guest checkout always settles to USDC on Solana (see api/claims/[id]'s normalisePayment,
  // which hardcodes to_symbol to "USDC") — same destination UsdcSolanaOption sends to directly.
  // /api/claims/quote requires this to compute a preview amount; without it every request 400s
  // regardless of which token is selected.
  const destUsdcToken = useMemo(
    () => tokens.find((t) => t.symbol?.toUpperCase() === "USDC" && ["solana", "sol"].includes((t.chain || "").toLowerCase())),
    [tokens],
  );

  // Wallet-connect state, one per supported family
  const { address: evmAddress } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [tonConnectUI] = useTonConnectUI();
  const tonAddress = useTonAddress();
  const [btcAddress, setBtcAddress] = useState<string | undefined>(undefined);
  const [btcConnecting, setBtcConnecting] = useState(false);
  const [manualRefund, setManualRefund] = useState("");

  // Selecting a different token invalidates whatever refund address was captured for the last one.
  useEffect(() => {
    setBtcAddress(undefined);
    setManualRefund("");
  }, [selection?.chain]);

  const connectBitcoin = async () => {
    setBtcConnecting(true);
    setError(null);
    try {
      const response = await satsConnectRequest("wallet_connect", { addresses: [AddressPurpose.Payment] });
      if (response.status === "error") throw new Error(response.error.message);
      const addr = response.result.addresses.find((a) => a.purpose === "payment")?.address;
      if (!addr) throw new Error("No payment address returned by wallet");
      setBtcAddress(addr);
    } catch (e: any) {
      setError(e?.message || "Failed to connect Bitcoin wallet. Install Xverse, Unisat, or Leather.");
    } finally {
      setBtcConnecting(false);
    }
  };

  const manualValid = selectedToken ? isValidAddressForChain(manualRefund, selectedToken.chain) : false;
  const refundAddress =
    chainFamily === "evm" ? evmAddress
    : chainFamily === "ton" ? tonAddress
    : chainFamily === "bitcoin" ? btcAddress
    : manualValid ? manualRefund.trim()
    : undefined;

  // Live "you'll send approximately X" preview — quoted with a placeholder refund address (this is
  // just an estimate; the real deposit below always uses the actual connected/entered address).
  const [previewAmount, setPreviewAmount] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    if (!selectedToken || !destUsdcToken) {
      setPreviewAmount(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewAmount(null);
    fetch("/api/claims/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimId,
        fromToken: {
          tokenId: selectedToken.tokenId || selectedToken.address,
          decimals: selectedToken.decimals,
          chain: selectedToken.chain,
          price: selectedToken.price,
        },
        destToken: {
          tokenId: destUsdcToken.tokenId || destUsdcToken.address,
          decimals: destUsdcToken.decimals,
          chain: destUsdcToken.chain,
          price: destUsdcToken.price,
        },
        fromTokenPriceUSD: selectedToken.price,
        destTokenPriceUSD: destUsdcToken.price,
        refundAddress: getRefundToForChain(selectedToken.chain),
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        // amountInFormatted (real dry-quote) and amountInEst (local USD/price fallback) are both
        // token-amount estimates in the same units — amountInUSD alone (no price data available)
        // can't be shown in this UI, which always renders "~X SYMBOL".
        setPreviewAmount(data?.amountInFormatted || data?.amountInEst || null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedToken, destUsdcToken, claimId]);

  const [creating, setCreating] = useState(false);
  const [deposit, setDeposit] = useState<DepositInfo | null>(null);
  const [settling, setSettling] = useState(false);

  const handleCreateDeposit = async () => {
    if (!selectedToken || !refundAddress) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/claims/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimId,
          fromToken: {
            tokenId: selectedToken.tokenId || selectedToken.address,
            decimals: selectedToken.decimals,
            chain: selectedToken.chain,
            symbol: selectedToken.symbol,
          },
          amount: amountUsd.toFixed(2),
          userAddress: refundAddress,
          refundAddress,
          guestEmail: email,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Failed to create deposit address");
      setDeposit({
        depositAddress: data.depositAddress,
        memo: data.memo ?? null,
        minAmountInFormatted: data.minAmountInFormatted,
        minAmountIn: data.minAmountIn,
      });
    } catch (e: any) {
      setError(e?.message || "Failed to create deposit address");
    } finally {
      setCreating(false);
    }
  };

  // TON: the connected wallet can build+sign+broadcast the deposit transfer itself via TonConnect
  // (tonConnectUI.sendTransaction) instead of only being used to capture a refund address — the
  // wallet already has everything it needs (deposit address + exact nanoton amount from the
  // response above). Settlement is still confirmed the same way either way: the poll loop below
  // watches the deposit address regardless of how the transfer actually got sent.
  const [tonSending, setTonSending] = useState(false);
  const [tonSent, setTonSent] = useState(false);
  const [tonSendError, setTonSendError] = useState<string | null>(null);
  const handleSendFromTonWallet = async () => {
    if (!deposit?.depositAddress || !deposit.minAmountIn) return;
    // A memo on a TON deposit would mean this is an INTENTS-mode shared address (see
    // /api/claims/deposit's INTENTS_ONLY_CHAINS) — TON isn't in that set, so this should never
    // actually happen, but a plain TonConnect transfer has no comment/memo field wired up here,
    // so refuse rather than silently sending a transfer NEAR Intents can't attribute.
    if (deposit.memo) {
      setTonSendError("This deposit needs a memo — send it manually using the details below.");
      return;
    }
    setTonSending(true);
    setTonSendError(null);
    try {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: deposit.depositAddress, amount: deposit.minAmountIn }],
      });
      setTonSent(true);
    } catch (e: any) {
      setTonSendError(e?.message || "Failed to send from wallet. You can still send manually below.");
    } finally {
      setTonSending(false);
    }
  };

  // Settlement is finalized server-side by the claim-processor cron; this only polls for UI
  // feedback and to know when to call onSettled().
  useEffect(() => {
    if (!deposit?.depositAddress) return;
    let aborted = false;
    setSettling(true);
    setError(null);
    const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS;
    (async () => {
      while (Date.now() < deadline) {
        if (aborted) return;
        try {
          const r = await fetch(`/api/status?depositAddress=${encodeURIComponent(deposit.depositAddress)}`, { cache: "no-store" });
          if (r.ok) {
            const s = await r.json();
            const st = String(s?.status || "").toUpperCase();
            if (st === "SUCCESS") {
              if (!aborted) {
                setSettling(false);
                onSettled();
              }
              return;
            }
            if (["FAILED", "REFUNDED", "EXPIRED"].includes(st)) {
              if (!aborted) {
                setSettling(false);
                setError("This payment failed or expired. Refresh the page to try again.");
              }
              return;
            }
          }
        } catch {
          // keep polling through transient errors
        }
        await new Promise((res) => setTimeout(res, STATUS_POLL_MS));
      }
      if (!aborted) setError("Still waiting for the deposit to arrive. Refresh in a moment once you've sent it.");
    })();
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deposit?.depositAddress]);

  if (deposit) {
    const canAutoSendTon = chainFamily === "ton" && !!tonAddress && !!deposit.minAmountIn && !deposit.memo;
    const payLabel = `Pay ${formatAmount(deposit.minAmountInFormatted)} ${selectedToken?.symbol || ""}`.trim();
    return (
      <div className="space-y-3 text-center">
        {canAutoSendTon ? (
          <div className="space-y-2">
            {tonSent ? (
              <p className="text-base font-medium text-green-600 [@media(prefers-color-scheme:dark)]:text-green-400">
                Sent from your wallet — waiting for confirmation…
              </p>
            ) : (
              <button
                type="button"
                onClick={handleSendFromTonWallet}
                disabled={tonSending}
                className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50"
              >
                {tonSending ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirm in your wallet…</> : payLabel}
              </button>
            )}
            {tonSendError && <p className="text-base text-red-600 [@media(prefers-color-scheme:dark)]:text-red-400">{tonSendError}</p>}
            {!tonSent && (
              <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">Or send manually</p>
            )}
          </div>
        ) : (
          <div>
            <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">Send exactly</p>
            <p className="text-lg font-semibold text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">
              {formatAmount(deposit.minAmountInFormatted)} {selectedToken?.symbol}
            </p>
            <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">
              on {formatChainLabel(selectedToken?.chain)}
            </p>
          </div>
        )}
        <QRCodeSVG value={deposit.depositAddress} size={140} className="mx-auto rounded-lg bg-white p-2 border border-gray-200" />
        <div className="rounded-lg bg-white border border-gray-200 px-3 py-2 break-all text-base font-mono text-gray-700 [@media(prefers-color-scheme:dark)]:bg-black/20 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:text-slate-300">
          {deposit.depositAddress}
        </div>
        {deposit.memo && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-base text-amber-700">
            Memo required: <span className="font-mono">{deposit.memo}</span>
          </div>
        )}
        <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400 flex items-center justify-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for it to arrive…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <TokenCombobox
        tokens={tokens}
        value={selection}
        onChange={setSelection}
        placeholder="Choose a token and network to pay with"
        hideChains={["sol", "solana"]}
        light
        className="bg-white border border-gray-300 [@media(prefers-color-scheme:dark)]:bg-black/20 [@media(prefers-color-scheme:dark)]:border-white/20"
      />

      {selectedToken && (
        <div className="rounded-lg bg-white border border-gray-200 px-3 py-2 text-center [@media(prefers-color-scheme:dark)]:bg-black/20 [@media(prefers-color-scheme:dark)]:border-white/10">
          {previewLoading ? (
            <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400 flex items-center justify-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculating amount…</p>
          ) : previewAmount ? (
            <>
              <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">You'll send approximately</p>
              <p className="text-lg font-semibold text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">{formatAmount(previewAmount)} {selectedToken.symbol}</p>
            </>
          ) : (
            <p className="text-base text-amber-600 [@media(prefers-color-scheme:dark)]:text-amber-400">Couldn't get a quote for this token — try another.</p>
          )}
        </div>
      )}

      {selectedToken && chainFamily === "evm" && !evmAddress && (
        <button
          type="button"
          onClick={() => openConnectModal?.()}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base border border-gray-300 text-gray-900 hover:bg-gray-50 [@media(prefers-color-scheme:dark)]:border-white/20 [@media(prefers-color-scheme:dark)]:text-slate-100 [@media(prefers-color-scheme:dark)]:hover:bg-white/5"
        >
          <LogIn className="w-4 h-4" /> Connect wallet
        </button>
      )}

      {selectedToken && chainFamily === "ton" && !tonAddress && (
        <button
          type="button"
          onClick={() => tonConnectUI.openModal()}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base border border-gray-300 text-gray-900 hover:bg-gray-50 [@media(prefers-color-scheme:dark)]:border-white/20 [@media(prefers-color-scheme:dark)]:text-slate-100 [@media(prefers-color-scheme:dark)]:hover:bg-white/5"
        >
          <LogIn className="w-4 h-4" /> Connect TON wallet
        </button>
      )}

      {selectedToken && chainFamily === "bitcoin" && !btcAddress && (
        <button
          type="button"
          onClick={connectBitcoin}
          disabled={btcConnecting}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base border border-gray-300 text-gray-900 hover:bg-gray-50 disabled:opacity-50 [@media(prefers-color-scheme:dark)]:border-white/20 [@media(prefers-color-scheme:dark)]:text-slate-100 [@media(prefers-color-scheme:dark)]:hover:bg-white/5"
        >
          {btcConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} Connect Bitcoin wallet
        </button>
      )}

      {selectedToken && refundAddress && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-base text-gray-600 flex items-center gap-2 [@media(prefers-color-scheme:dark)]:bg-white/5 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:text-slate-300">
          <WalletIcon className="w-4 h-4 shrink-0" />
          <span className="truncate">Refund address: {refundAddress.slice(0, 8)}…{refundAddress.slice(-6)}</span>
        </div>
      )}

      {selectedToken && chainFamily === "other" && (
        <div className="space-y-1">
          <input
            type="text"
            value={manualRefund}
            onChange={(e) => setManualRefund(e.target.value)}
            placeholder={`Your ${selectedToken.symbol} refund address`}
            className="w-full rounded-lg bg-white border border-gray-300 px-3 py-2 text-base text-gray-900 outline-none focus:border-orange-400 [@media(prefers-color-scheme:dark)]:bg-black/20 [@media(prefers-color-scheme:dark)]:border-white/20 [@media(prefers-color-scheme:dark)]:text-slate-100"
          />
          {manualRefund && !manualValid && (
            <p className="text-base text-red-600 [@media(prefers-color-scheme:dark)]:text-red-400">Doesn't look like a valid {formatChainLabel(selectedToken.chain)} address.</p>
          )}
        </div>
      )}

      {selectedToken && refundAddress && (
        <button
          type="button"
          onClick={handleCreateDeposit}
          disabled={creating || settling}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50"
        >
          {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</> : "Get deposit address"}
        </button>
      )}
    </div>
  );
}

export function NearIntentsAnyTokenOption({
  claimId,
  amountUsd,
  email,
  expanded,
  onToggle,
  onSettled,
  setError,
  disabled = false,
}: {
  claimId: string;
  amountUsd: number;
  /** Guest checkout's shared email field, stamped onto the payment as guest_sender_email once the
   *  deposit is created — otherwise a bridge-paid guest payment shows as "Anonymous" everywhere
   *  (history, claim page) since nothing else identifies the payer for this flow. */
  email: string;
  expanded: boolean;
  onToggle: () => void;
  onSettled: () => void;
  setError: (e: string | null) => void;
  /** Private payments only go through onPayPrivately's MagicBlock transfer (USDC on Solana / Pay
   *  with Loofta) — the NEAR Intents bridge has no private variant, so this tile is disabled
   *  (and collapsed if already open) while private mode is on, instead of offering a "private"
   *  payment that would actually land publicly. */
  disabled?: boolean;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        title={disabled ? "Not available for private payments" : undefined}
        className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${
          disabled
            ? "border-gray-200 opacity-40 cursor-not-allowed [@media(prefers-color-scheme:dark)]:border-white/10"
            : expanded
              ? "border-orange-400 bg-orange-50 [@media(prefers-color-scheme:dark)]:bg-orange-500/10"
              : "border-gray-200 hover:bg-gray-50 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:hover:bg-white/5"
        }`}
      >
        <Globe className="w-8 h-8 text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400" />
        <span className="text-base font-medium text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">Any token</span>
      </button>

      {!disabled && expanded && (
        <div className="col-span-2 [grid-row:2] rounded-xl border border-gray-200 bg-gray-50 p-4 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:bg-white/5">
          <DynamicWalletProviders>
            <PayPanel claimId={claimId} amountUsd={amountUsd} email={email} onSettled={onSettled} setError={setError} />
          </DynamicWalletProviders>
        </div>
      )}
    </>
  );
}
