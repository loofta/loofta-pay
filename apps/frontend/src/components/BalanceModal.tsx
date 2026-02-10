"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenIcon } from "@/components/TokenIcon";
import { findTokenBySelection } from "@/lib/tokens";
import type { TokenSelection } from "@/app/utils/types";
import { TokenCombobox } from "@/components/TokenCombobox";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { buildUSDCTransferTransaction } from "@/services/solanaTransfer";
import { getDepositInfo } from "@/services/nearIntents";
import type { NearToken } from "@/services/nearIntents";
import { isValidAddressForChain } from "@/lib/refundAddresses";
import { addWithdrawal, getWithdrawalHistory, type WithdrawalHistoryItem } from "@/lib/withdrawalHistory";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import { ExternalLink } from "lucide-react";

const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  (process.env.NEXT_PUBLIC_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com");

const LOG_PREFIX = "[BalanceModal]";

export interface BalanceModalProps {
  open: boolean;
  onClose: () => void;
  balanceUSD: string;
  loadingBalance: boolean;
  solanaAddress: string | null;
  onRefresh: () => void;
}

export function BalanceModal({
  open,
  onClose,
  balanceUSD,
  loadingBalance,
  solanaAddress,
  onRefresh,
}: BalanceModalProps) {
  const { toast } = useToast();
  const { data: tokens = [] } = useTokensQuery();

  const [tab, setTab] = useState<"withdraw" | "history">("withdraw");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [addressRiskStatus, setAddressRiskStatus] = useState<"idle" | "checking" | "safe" | "unsafe">("idle");
  const [recentWithdrawals, setRecentWithdrawals] = useState<WithdrawalHistoryItem[]>([]);

  useEffect(() => {
    if (open) setRecentWithdrawals(getWithdrawalHistory());
  }, [open]);

  const { wallets: solanaWallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const wallet = useMemo(
    () => (solanaAddress ? solanaWallets?.find((w) => w.address === solanaAddress) : undefined),
    [solanaAddress, solanaWallets]
  );

  // USDC on Solana - primary balance we have in embedded wallet
  const usdcSolanaToken = useMemo(
    () =>
      tokens.find(
        (t) =>
          t.symbol?.toUpperCase() === "USDC" &&
          (t.chain?.toLowerCase() === "solana" || t.chain?.toLowerCase() === "sol")
      ),
    [tokens]
  );

  // Default to USDC/Solana when token list loads
  const selectedFrom = useMemo(
    () => findTokenBySelection(tokens, fromSel ?? (usdcSolanaToken ? { symbol: usdcSolanaToken.symbol, chain: usdcSolanaToken.chain } : undefined)),
    [tokens, fromSel, usdcSolanaToken]
  );

  const effectiveToken = selectedFrom || usdcSolanaToken;
  const isUSDCOnSolana =
    effectiveToken?.symbol === "USDC" &&
    (effectiveToken?.chain === "solana" || effectiveToken?.chain === "sol");
  /** For display: selected token balance (only USDC Solana has balance). */
  const balanceNum = isUSDCOnSolana ? parseFloat(balanceUSD) || 0 : 0;
  const balanceDisplay = isUSDCOnSolana ? balanceUSD : "0.00";
  /** We always pay from USDC (Solana) balance; for other tokens we use Near Intents. */
  const payFromBalanceNum = parseFloat(balanceUSD) || 0;
  const destChain = effectiveToken?.chain || "";
  const isNearIntentsWithdraw = !isUSDCOnSolana && effectiveToken && usdcSolanaToken;
  const destinationAddressValid = isValidAddressForChain(withdrawAddress, isUSDCOnSolana ? "solana" : destChain);

  /** Check destination address with Range risk API (server-side). */
  const checkAddressRisk = useCallback(async (address: string): Promise<{ safe: boolean }> => {
    const res = await fetch(
      `/api/risk/address?address=${encodeURIComponent(address)}&network=solana`
    );
    const data = await res.json().catch(() => ({}));
    return { safe: data.safe !== false };
  }, []);

  /** Debounced Range check when user enters a valid Solana address (only for direct USDC→Solana withdraw). */
  useEffect(() => {
    if (!isUSDCOnSolana) {
      setAddressRiskStatus("idle");
      return;
    }
    const raw = withdrawAddress.trim();
    const isValidFormat = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw);
    if (!raw || !isValidFormat) {
      setAddressRiskStatus("idle");
      return;
    }
    setAddressRiskStatus("checking");
    const t = setTimeout(async () => {
      const { safe } = await checkAddressRisk(raw);
      setAddressRiskStatus(safe ? "safe" : "unsafe");
    }, 500);
    return () => clearTimeout(t);
  }, [withdrawAddress, checkAddressRisk, isUSDCOnSolana]);

  const handleWithdraw = async () => {
    const rawAddress = withdrawAddress.trim();
    const amount = parseFloat(withdrawAmount);
    if (!(amount > 0)) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Enter an amount greater than 0." });
      return;
    }
    if (amount > payFromBalanceNum) {
      toast({ variant: "destructive", title: "Insufficient balance", description: `You have $${balanceUSD} USDC. Enter a lower amount.` });
      return;
    }
    if (!solanaAddress || !wallet) {
      toast({ variant: "destructive", title: "Wallet not ready", description: "Your Loofta wallet is not available. Try refreshing or logging out and back in." });
      return;
    }

    if (isUSDCOnSolana) {
      if (!rawAddress || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawAddress)) {
        toast({ variant: "destructive", title: "Invalid address", description: "Enter a valid Solana wallet address." });
        return;
      }
      if (addressRiskStatus !== "safe") {
        toast({ variant: "destructive", title: "Address not approved", description: "Withdrawals are only allowed to addresses that pass our compliance check." });
        return;
      }
    } else {
      if (!rawAddress || !destinationAddressValid) {
        toast({ variant: "destructive", title: "Invalid address", description: `Enter a valid ${destChain || "destination"} address for the selected token.` });
        return;
      }
      if (!usdcSolanaToken || !effectiveToken) {
        toast({ variant: "destructive", title: "Invalid token", description: "Select a token to withdraw to." });
        return;
      }
    }

    setWithdrawing(true);
    try {
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      let recipientAddress: string;
      let memo: string | null = null;

      if (isNearIntentsWithdraw && usdcSolanaToken && effectiveToken) {
        console.log(`${LOG_PREFIX} Near Intents withdraw: requesting deposit info`, {
          fromToken: { symbol: usdcSolanaToken.symbol, chain: usdcSolanaToken.chain },
          toToken: { symbol: effectiveToken.symbol, chain: effectiveToken.chain },
          amount: amount.toString(),
          recipient: rawAddress,
          sender: solanaAddress,
        });
        const depositInfo = await getDepositInfo({
          fromToken: usdcSolanaToken as NearToken,
          toToken: effectiveToken as NearToken,
          amount: amount.toString(),
          recipient: rawAddress,
          sender: solanaAddress,
          refundAddress: solanaAddress,
          slippageBps: 100,
        });
        recipientAddress = depositInfo.depositAddress ?? "";
        memo = depositInfo.memo ?? null;
        console.log(`${LOG_PREFIX} Near Intents deposit info`, {
          depositAddress: depositInfo.depositAddress,
          memo: depositInfo.memo,
          quoteId: depositInfo.quoteId,
          deadline: depositInfo.deadline,
          timeEstimate: depositInfo.timeEstimate,
          minDepositFormatted: depositInfo.minDepositFormatted,
        });
        if (!recipientAddress || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipientAddress)) {
          console.error(`${LOG_PREFIX} Near Intents returned invalid Solana deposit address:`, recipientAddress);
          throw new Error("Invalid deposit address from Near Intents. Please try again.");
        }
      } else {
        recipientAddress = rawAddress;
      }

      // Log deposit address so you can verify it matches (e.g. Near Intents vs chain explorer)
      console.log(`${LOG_PREFIX} Privy transaction deposit address (USDC send-to):`, recipientAddress, isNearIntentsWithdraw ? "(from Near Intents)" : "(direct withdraw)");

      const unsignedTx = await buildUSDCTransferTransaction({
        senderAddress: solanaAddress,
        recipientAddress,
        amountUSDC: amount,
        connection,
        memo: memo ?? undefined,
      });
      const { signature } = await signAndSendTransaction({
        transaction: unsignedTx.serialize(),
        wallet,
        options: { sponsor: true } as never,
      });
      const sig = bs58.encode(signature);
      console.log(`${LOG_PREFIX} Withdraw tx sent`, {
        signature: sig,
        amountUSDC: amount,
        isNearIntents: isNearIntentsWithdraw,
        ...(isNearIntentsWithdraw && {
          depositAddress: recipientAddress,
          memo,
          destinationToken: effectiveToken?.symbol,
          destinationChain: effectiveToken?.chain,
          destinationAddress: rawAddress,
        }),
      });
      toast({
        title: "Withdrawal sent",
        description: isNearIntentsWithdraw
          ? `$${amount.toFixed(2)} USDC → ${effectiveToken?.symbol} on ${effectiveToken?.chain}. Tx: ${sig.slice(0, 8)}…`
          : `$${amount.toFixed(2)} USDC sent. Tx: ${sig.slice(0, 8)}…`,
      });
      setWithdrawAmount("");
      setWithdrawAddress("");
      setAddressRiskStatus("idle");
      addWithdrawal({
        id: sig,
        amountUSDC: amount,
        txSignature: sig,
        destinationAddress: rawAddress,
        destinationChain: isNearIntentsWithdraw ? (effectiveToken?.chain ?? "solana") : "solana",
        destinationToken: isNearIntentsWithdraw ? (effectiveToken?.symbol ?? "USDC") : "USDC",
        isNearIntents: Boolean(isNearIntentsWithdraw),
      });
      setRecentWithdrawals(getWithdrawalHistory());
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} Withdraw error`, { message: msg, isNearIntents: isNearIntentsWithdraw });
      if (msg.includes("user rejected") || msg.includes("denied") || msg.includes("User denied")) {
        toast({ variant: "destructive", title: "Cancelled", description: "You cancelled the transaction." });
      } else if (msg.includes("insufficient") || msg.includes("Insufficient")) {
        toast({ variant: "destructive", title: "Insufficient balance", description: "Not enough USDC for this withdrawal." });
      } else {
        toast({ variant: "destructive", title: "Withdrawal failed", description: msg || "Please try again." });
      }
    } finally {
      setWithdrawing(false);
    }
  };

  const shortAddr = (addr: string, h = 6, t = 4) =>
    addr.length > h + t ? `${addr.slice(0, h)}…${addr.slice(-t)}` : addr;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Balance & Withdraw</DialogTitle>
          <DialogDescription>
            View your balance and withdraw to any Solana wallet.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-lg bg-gray-100">
          <button
            type="button"
            onClick={() => setTab("withdraw")}
            className={`flex-1 rounded-md py-2 text-sm font-medium ${tab === "withdraw" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
          >
            Withdraw
          </button>
          <button
            type="button"
            onClick={() => {
              setRecentWithdrawals(getWithdrawalHistory());
              setTab("history");
            }}
            className={`flex-1 rounded-md py-2 text-sm font-medium ${tab === "history" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
          >
            Recent
          </button>
        </div>

        {tab === "history" ? (
          <div className="py-2 max-h-[60vh] overflow-y-auto">
            {recentWithdrawals.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No recent withdrawals.</p>
            ) : (
              <ul className="space-y-2">
                {recentWithdrawals.map((item) => (
                  <li key={item.id}>
                    <a
                      href={getExplorerTxUrl("solana", item.txSignature)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 hover:border-gray-300 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900 text-sm">
                          ${item.amountUSDC.toFixed(2)} → {item.destinationToken} ({item.destinationChain})
                        </p>
                        <p className="text-xs text-gray-500 font-mono mt-0.5">
                          To {shortAddr(item.destinationAddress)}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(item.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <ExternalLink className="h-4 w-4 shrink-0 text-gray-400" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
        <div className="space-y-4 py-4">
          {/* Balance – token/chain + dollar amount */}
          <div>
            <Label className="text-sm font-medium text-gray-500 mb-2 block">
              {isNearIntentsWithdraw ? "Paying from (USDC on Solana)" : "Available balance"}
            </Label>
            <div className="p-4 rounded-xl border-2 border-gray-200 bg-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center">
                  {(isNearIntentsWithdraw ? usdcSolanaToken : effectiveToken) && (
                    <TokenIcon
                      token={(isNearIntentsWithdraw ? usdcSolanaToken : effectiveToken)!}
                      chain={isNearIntentsWithdraw ? "solana" : effectiveToken?.chain}
                      size={24}
                    />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    {isNearIntentsWithdraw ? "USDC / Solana" : `${effectiveToken?.symbol || "USDC"} / ${effectiveToken?.chain || "Solana"}`}
                  </p>
                  <p className="text-xl font-semibold text-gray-900 mt-0.5">
                    {isUSDCOnSolana && loadingBalance ? "…" : `$${isNearIntentsWithdraw ? balanceUSD : balanceDisplay}`}
                  </p>
                </div>
              </div>
            </div>
            {!loadingBalance && balanceNum <= 0 && isUSDCOnSolana && (
              <p className="text-sm text-amber-600 mt-2">No balance to withdraw.</p>
            )}
            {isNearIntentsWithdraw && payFromBalanceNum > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                You will pay from your USDC (Solana) balance. Fees are sponsored.
              </p>
            )}
          </div>

          {/* Token/network selector for withdraw */}
          <div>
            <Label className="text-sm font-medium text-gray-700 mb-2 block">
              Withdraw with
            </Label>
            <TokenCombobox
              tokens={tokens}
              value={fromSel ?? (usdcSolanaToken ? { symbol: usdcSolanaToken.symbol, chain: usdcSolanaToken.chain } : undefined)}
              onChange={setFromSel}
              placeholder="Select token to receive"
              className="w-full h-12 rounded-xl border-2 border-gray-200 bg-white text-center"
              defaultShowAllChains
            />
            <p className="text-xs text-gray-500 mt-1">
              {isUSDCOnSolana
                ? "Withdraw to any Solana wallet. Fees are sponsored."
                : `Withdraw to ${effectiveToken?.symbol} on ${effectiveToken?.chain} via Near Intents. Enter destination address on ${effectiveToken?.chain}.`}
            </p>
          </div>

          {/* Amount */}
          <div>
            <Label htmlFor="withdraw-amount">
              Amount (USDC to send)
              {isNearIntentsWithdraw && effectiveToken && (
                <span className="text-gray-500 font-normal"> → receive ~{effectiveToken.symbol} on {effectiveToken.chain}</span>
              )}
            </Label>
            <Input
              id="withdraw-amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              className="mt-1 font-mono"
            />
            {payFromBalanceNum > 0 && (
              <button
                type="button"
                onClick={() => setWithdrawAmount(balanceUSD)}
                className="text-xs text-orange-600 hover:underline mt-1"
              >
                Max
              </button>
            )}
          </div>



          {/* Destination address */}
          <div>
            <Label htmlFor="withdraw-address">
              {isUSDCOnSolana ? "Destination Solana wallet" : `Destination address (${effectiveToken?.chain || "recipient"})`}
            </Label>
            <Input
              id="withdraw-address"
              placeholder={isUSDCOnSolana ? "Enter Solana address" : `Enter ${effectiveToken?.chain || "destination"} address (e.g. 0x… for EVM)`}
              value={withdrawAddress}
              onChange={(e) => setWithdrawAddress(e.target.value)}
              className="mt-1 font-mono text-sm"
            />
            {isUSDCOnSolana && addressRiskStatus === "checking" && (
              <p className="text-xs text-gray-600 mt-1.5 flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                Checking address with Range…
              </p>
            )}
            {isUSDCOnSolana && addressRiskStatus === "safe" && (
              <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                Address compliant — safe to withdraw
              </p>
            )}
            {isUSDCOnSolana && addressRiskStatus === "unsafe" && (
              <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Address flagged — withdrawal blocked for your protection
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1.5">
              {isUSDCOnSolana ? "Withdrawals are free — transaction fees are sponsored." : "Your USDC is sent to Near Intents; they route to the selected token/chain."}
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleWithdraw}
              disabled={
                withdrawing ||
                payFromBalanceNum <= 0 ||
                !withdrawAmount ||
                parseFloat(withdrawAmount) <= 0 ||
                !withdrawAddress.trim() ||
                !wallet ||
                (isUSDCOnSolana ? addressRiskStatus !== "safe" : !destinationAddressValid)
              }
              className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {withdrawing ? "Sending…" : "Withdraw"}
            </Button>
          </div>
          {!loadingBalance && payFromBalanceNum <= 0 && (
            <p className="text-xs text-gray-500 text-center">Add funds to your wallet to withdraw.</p>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
