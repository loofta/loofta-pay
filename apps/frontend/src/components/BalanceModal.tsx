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
import { PRIVATE_PAYMENT_COMING_SOON } from "@/services/privacyCash";

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

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [addressRiskStatus, setAddressRiskStatus] = useState<"idle" | "checking" | "safe" | "unsafe">("idle");

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
  const balanceNum = parseFloat(balanceUSD) || 0;
  const isUSDCOnSolana =
    effectiveToken?.symbol === "USDC" &&
    (effectiveToken?.chain === "solana" || effectiveToken?.chain === "sol");

  /** Check destination address with Range risk API (server-side). */
  const checkAddressRisk = useCallback(async (address: string): Promise<{ safe: boolean }> => {
    const res = await fetch(
      `/api/risk/address?address=${encodeURIComponent(address)}&network=solana`
    );
    const data = await res.json().catch(() => ({}));
    return { safe: data.safe !== false };
  }, []);

  /** Debounced Range check when user enters a valid Solana address. */
  useEffect(() => {
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
  }, [withdrawAddress, checkAddressRisk]);

  const handleWithdraw = async () => {
    if (PRIVATE_PAYMENT_COMING_SOON) {
      toast({
        title: "Coming soon",
        description: "Private withdrawals will be available soon.",
      });
      return;
    }
    toast({
      variant: "destructive",
      title: "Not available",
      description: "Withdrawals are coming soon.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Balance & Withdraw</DialogTitle>
          <DialogDescription>
            View your balance and withdraw to any Solana wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Balance – token/chain + dollar amount */}
          <div>
            <Label className="text-sm font-medium text-gray-500 mb-2 block">
              Available balance
            </Label>
            <div className="p-4 rounded-xl border-2 border-gray-200 bg-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center">
                  {effectiveToken && (
                    <TokenIcon token={effectiveToken} chain={effectiveToken.chain} size={24} />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    {effectiveToken?.symbol || "USDC"} / {effectiveToken?.chain || "Solana"}
                  </p>
                  <p className="text-xl font-semibold text-gray-900 mt-0.5">
                    {loadingBalance ? "…" : `$${balanceUSD}`}
                  </p>
                </div>
              </div>
            </div>
            {!loadingBalance && balanceNum <= 0 && (
              <p className="text-sm text-amber-600 mt-2">No balance to withdraw.</p>
            )}
          </div>

          {/* Token/network selector for withdraw (same style as claim) */}
          <div>
            <Label className="text-sm font-medium text-gray-700 mb-2 block">
              Withdraw with
            </Label>
            <TokenCombobox
              tokens={tokens.filter(
                (t) =>
                  t.symbol === "USDC" &&
                  (t.chain?.toLowerCase() === "solana" || t.chain?.toLowerCase() === "sol")
              )}
              value={fromSel ?? (usdcSolanaToken ? { symbol: usdcSolanaToken.symbol, chain: usdcSolanaToken.chain } : undefined)}
              onChange={setFromSel}
              placeholder="Select token"
              className="w-full h-12 rounded-xl border-2 border-gray-200 bg-white text-center"
            />
            <p className="text-xs text-gray-500 mt-1">
              Your embedded wallet holds USDC on Solana. Other networks coming soon.
            </p>
          </div>

          {/* Amount */}
          <div>
            <Label htmlFor="withdraw-amount">Amount (USD)</Label>
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
            {balanceNum > 0 && (
              <button
                type="button"
                onClick={() => setWithdrawAmount(balanceUSD)}
                className="text-xs text-orange-600 hover:underline mt-1"
              >
                Max
              </button>
            )}
          </div>



          {/* Destination wallet address */}
          <div>
            <Label htmlFor="withdraw-address">Destination Solana wallet</Label>
            <Input
              id="withdraw-address"
              placeholder="Enter Solana address"
              value={withdrawAddress}
              onChange={(e) => setWithdrawAddress(e.target.value)}
              className="mt-1 font-mono text-sm"
            />
            {addressRiskStatus === "checking" && (
              <p className="text-xs text-gray-600 mt-1.5 flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                Checking address with Range…
              </p>
            )}
            {addressRiskStatus === "safe" && (
              <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                Address compliant — safe to withdraw
              </p>
            )}
            {addressRiskStatus === "unsafe" && (
              <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Address flagged — withdrawal blocked for your protection
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1.5">
              Private withdrawals — coming soon.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleWithdraw}
              disabled={withdrawing}
              className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              title="Private withdrawals coming soon"
            >
              {PRIVATE_PAYMENT_COMING_SOON ? "Coming soon" : withdrawing ? "Sending…" : "Withdraw"}
            </Button>
          </div>
          {!loadingBalance && balanceNum <= 0 && (
            <p className="text-xs text-gray-500 text-center">Add funds to your wallet to withdraw.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
