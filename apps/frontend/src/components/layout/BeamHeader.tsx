'use client'

import { useState, useEffect, useCallback } from "react";
import {
  usePrivy,
  useWallets as useEvmWallets,
  useSendTransaction as useEvmSendTransaction,
} from "@privy-io/react-auth";
import { base } from "viem/chains";
import { createPublicClient, http, erc20Abi, encodeFunctionData } from "viem";
import { useAuth } from "@/hooks/useAuth";
import { LooftaPayLogoLink } from "@/components/layout/LooftaPayLogoLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/components/ui/use-toast";
import { assertEvmSponsorAllowed, BASE_USDC_ADDRESS } from "@/lib/zkp2pClient";
import { useTranslations } from "next-intl";

const HEADER_HEIGHT = 64;
const basePublicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

// Logo-only chrome for standalone products (e.g. /beam) — same Loofta login as the rest
// of the app, but no Send & Receive / Rewards / Megapot / Balance nav. In place of the
// usual account menu, shows the Base USDC balance this product actually spends from,
// with a way to withdraw it back out.
export function BeamHeader() {
  const t = useTranslations('MinimalHeader');
  const { authenticated, userId, logout, getAccessToken } = useAuth();
  const { login: privyLogin } = usePrivy();
  const { wallets: evmWallets } = useEvmWallets();
  const { sendTransaction: privySendEvmTx } = useEvmSendTransaction();
  const { toast } = useToast();

  const baseWallet = evmWallets.find((w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function");

  const [balance, setBalance] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAddr, setWithdrawAddr] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!baseWallet) return;
    try {
      const bal = await basePublicClient.readContract({
        address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [baseWallet.address as `0x${string}`],
      }) as bigint;
      setBalance(Number(bal) / 1_000_000);
    } catch { /* keep the last known value on a transient RPC error */ }
  }, [baseWallet]);

  useEffect(() => {
    if (!authenticated || !baseWallet) return;
    refreshBalance();
    const id = setInterval(refreshBalance, 15000);
    return () => clearInterval(id);
  }, [authenticated, baseWallet, refreshBalance]);

  const handleWithdraw = async () => {
    if (!baseWallet || !withdrawAddr.trim() || !withdrawAmount) return;
    const amountNum = parseFloat(withdrawAmount);
    if (!(amountNum > 0) || (balance !== null && amountNum > balance)) {
      toast({ variant: "destructive", title: "Enter a valid amount" });
      return;
    }
    setWithdrawing(true);
    try {
      const amountAtomic = BigInt(Math.round(amountNum * 1_000_000));
      const evmGateToken = await getAccessToken();
      await assertEvmSponsorAllowed(baseWallet.address, userId ?? "", evmGateToken);
      await privySendEvmTx({
        to: BASE_USDC_ADDRESS,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [withdrawAddr.trim() as `0x${string}`, amountAtomic] }),
        chainId: base.id,
      }, { sponsor: true });
      toast({ title: "Sent", description: `$${withdrawAmount} sent to ${withdrawAddr.trim().slice(0, 6)}…${withdrawAddr.trim().slice(-4)}` });
      setWithdrawOpen(false);
      setWithdrawAddr("");
      setWithdrawAmount("");
      refreshBalance();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Withdraw failed";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <>
      <header
        className="sticky top-0 z-40 flex items-center bg-[#0f0f12]"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="w-full max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between">
          <div className="flex items-center min-w-0">
            <LooftaPayLogoLink imageWidth={120} imageHeight={36} imageClassName="h-9 w-auto" />
          </div>

          <div className="flex items-center shrink-0">
            {authenticated ? (
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 text-white hover:bg-white/15 border border-white/10 transition-colors"
                  >
                    <span className="text-sm font-semibold tabular-nums">
                      ${balance !== null ? balance.toFixed(2) : "—"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="bg-[#17171b] border-white/10 text-white w-64 p-4 space-y-3">
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide">Balance</p>
                    <p className="text-2xl font-bold text-white tabular-nums">${balance !== null ? balance.toFixed(2) : "0.00"}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Used automatically for your next payment if there's enough.</p>
                  </div>
                  <Button
                    onClick={() => { setMenuOpen(false); setWithdrawOpen(true); }}
                    disabled={!balance}
                    className="w-full h-10 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-white"
                  >
                    Withdraw
                  </Button>
                  <button
                    type="button"
                    onClick={() => logout()}
                    className="w-full text-sm text-slate-400 hover:text-white text-left"
                  >
                    Log out
                  </button>
                </PopoverContent>
              </Popover>
            ) : (
              <button
                type="button"
                onClick={() => privyLogin({ loginMethods: ["email", "twitter"], disableSignup: false })}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                {t('signIn')}
              </button>
            )}
          </div>
        </div>
      </header>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="bg-[#0f0f12] border border-white/10 text-white sm:max-w-md rounded-2xl p-7">
          <DialogTitle className="text-xl font-bold text-white">Withdraw</DialogTitle>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm text-slate-300 block mb-1.5">Amount</label>
              <Input
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                className="h-12 bg-white/5 border-white/10 text-white text-lg"
              />
              <button
                type="button"
                onClick={() => setWithdrawAmount(balance !== null ? balance.toFixed(2) : "")}
                className="text-sm text-orange-400 hover:text-orange-300 mt-1.5"
              >
                Max ${balance !== null ? balance.toFixed(2) : "0.00"}
              </button>
            </div>
            <div>
              <label className="text-sm text-slate-300 block mb-1.5">To address (Base)</label>
              <Input
                value={withdrawAddr}
                onChange={(e) => setWithdrawAddr(e.target.value.trim())}
                placeholder="0x…"
                className="h-12 bg-white/5 border-white/10 text-white font-mono text-sm"
              />
            </div>
            <Button
              onClick={handleWithdraw}
              disabled={withdrawing || !withdrawAddr.trim() || !withdrawAmount}
              className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
            >
              {withdrawing ? "Sending…" : "Withdraw"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
