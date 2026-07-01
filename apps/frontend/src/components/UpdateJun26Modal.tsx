"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import { fetchEmbeddedSolanaUsdcBalance } from "@/services/solanaBalance";
import { markLocallyDone, UPDATE_ID } from "@/hooks/useUpdateJun26";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2 } from "lucide-react";

type Step = "idle" | "archiving" | "creating" | "completing" | "done";

function stepLabel(step: Step): string {
  if (step === "archiving") return "Archiving old wallet…";
  if (step === "creating") return "Creating new wallet…";
  if (step === "completing") return "Finalizing…";
  return "";
}

function useNetworkBalance(address: string | null, network: "mainnet" | "devnet", enabled: boolean) {
  return useQuery({
    queryKey: ["updateModal-balance", network, address ?? "__none__"],
    queryFn: () => fetchEmbeddedSolanaUsdcBalance(address!, network),
    enabled: enabled && !!address,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
}

export function UpdateJun26Modal({ show }: { show: boolean }) {
  const { user, authenticated, getAccessToken, logout } = usePrivy();
  const setNetworkMode = useAuthStore((s) => s.setNetworkMode);
  const address = deriveSolanaEmbeddedAddress(user);

  const queryEnabled = show && authenticated === true;

  const mainnet = useNetworkBalance(address, "mainnet", queryEnabled);
  const devnet = useNetworkBalance(address, "devnet", queryEnabled);

  const mainnetBalance = mainnet.data?.balanceUSD ?? 0;
  const devnetBalance = devnet.data?.balanceUSD ?? 0;
  const mainnetNeedsWithdraw = !mainnet.isLoading && mainnetBalance > 0.01;
  const devnetNeedsWithdraw = !devnet.isLoading && devnetBalance > 0.01;
  const anyNeedsWithdraw = mainnetNeedsWithdraw || devnetNeedsWithdraw;
  const allLoading = mainnet.isLoading && devnet.isLoading;

  const openWithdraw = (network: "mainnet" | "devnet") => {
    setNetworkMode(network);
    window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab: "withdraw" } }));
  };

  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const isWorking = step === "archiving" || step === "creating" || step === "completing";
  const isDone = step === "done";

  const handleUpdate = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      if (address) {
        setStep("archiving");
        const archiveRes = await fetch("/api/users/archive-wallet", {
          method: "POST",
          headers,
          body: JSON.stringify({ walletAddress: address }),
        });
        if (!archiveRes.ok) {
          const e = await archiveRes.json().catch(() => ({}));
          throw new Error((e as { error?: string }).error ?? "Failed to archive wallet");
        }
      }

      setStep("creating");
      const createRes = await fetch("/api/users/create-solana-wallet", {
        method: "POST",
        headers,
      });
      if (!createRes.ok) {
        const e = await createRes.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? "Failed to create new wallet");
      }

      setStep("completing");
      await fetch("/api/users/update-jun26/complete", {
        method: "POST",
        headers,
        body: JSON.stringify({ update_id: UPDATE_ID }),
      });
      if (user?.id) markLocallyDone(user.id);

      setStep("done");
      setTimeout(() => window.location.reload(), 1800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setStep("idle");
    } finally {
      runningRef.current = false;
    }
  };

  return (
    <Dialog open={show} onOpenChange={() => {}} modal={false}>
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className={cn(
          "left-0 right-0 top-0 translate-x-0 translate-y-0 h-[100dvh] max-h-[100dvh] w-[100vw] max-w-[100vw] rounded-none border-0 p-0 gap-0 overflow-hidden flex flex-col",
          "sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-md sm:rounded-2xl sm:border sm:p-7 sm:gap-4 sm:overflow-y-auto sm:flex-none sm:block",
          "border-white/10 bg-[#0f0f12] text-white",
          "[&>button]:hidden",
        )}
      >
        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-5 pb-2 shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto sm:contents px-6 pb-8 sm:p-0 space-y-5">
          <DialogHeader className="pb-0 pt-2 sm:pt-0">
            <DialogTitle className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Update required
            </DialogTitle>
            <DialogDescription className="text-base font-medium mt-0.5 text-slate-400">
              A one-time wallet upgrade to keep using Loofta
            </DialogDescription>
          </DialogHeader>

          {isDone ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-white font-semibold text-lg">Loofta updated</p>
                <p className="text-slate-400 text-sm mt-1">Reloading your app…</p>
              </div>
            </div>
          ) : (
            <>
              {/* Network balance cards */}
              <div className="space-y-2">
                <NetworkBalanceRow
                  label="Mainnet"
                  balance={mainnetBalance}
                  isLoading={mainnet.isLoading}
                  needsWithdraw={mainnetNeedsWithdraw}
                  onWithdraw={() => openWithdraw("mainnet")}
                />
                <NetworkBalanceRow
                  label="Devnet"
                  balance={devnetBalance}
                  isLoading={devnet.isLoading}
                  needsWithdraw={devnetNeedsWithdraw}
                  onWithdraw={() => openWithdraw("devnet")}
                />
              </div>

              {/* Action section */}
              {!allLoading && anyNeedsWithdraw ? (
                <div className="rounded-2xl bg-[#FF1301]/10 border border-[#FF1301]/25 px-5 py-4">
                  <p className="text-white font-semibold text-xl leading-snug">
                    Withdraw your balance before updating
                  </p>
                  <p className="text-slate-400 text-sm mt-1.5 leading-relaxed">
                    Click Withdraw on each network that still has funds and send them out before continuing.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {!allLoading && (
                    <p className="text-slate-400 text-sm leading-relaxed">
                      {isWorking
                        ? stepLabel(step)
                        : "All clear — this takes just a few seconds and gives you a fresh wallet."}
                    </p>
                  )}

                  {error && <p className="text-red-400 text-sm">{error}</p>}

                  <button
                    type="button"
                    onClick={handleUpdate}
                    disabled={isWorking || allLoading}
                    className="w-full h-12 rounded-xl font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                  >
                    {isWorking && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isWorking ? "Updating…" : error ? "Try again" : "Update Loofta"}
                  </button>
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <a
                  href="https://t.me/looftapay"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Contact support
                </a>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NetworkBalanceRow({
  label,
  balance,
  isLoading,
  needsWithdraw,
  onWithdraw,
}: {
  label: string;
  balance: number;
  isLoading: boolean;
  needsWithdraw: boolean;
  onWithdraw: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] border border-white/[0.07] px-5 py-4">
      <div className="space-y-0.5">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</p>
        {isLoading ? (
          <div className="h-7 w-24 rounded-md bg-white/10 animate-pulse" />
        ) : (
          <p className="text-2xl font-bold tracking-tight tabular-nums text-white">
            ${balance.toFixed(2)}
            <span className="text-sm font-medium text-slate-500 ml-1.5">USDC</span>
          </p>
        )}
      </div>

      {isLoading ? null : needsWithdraw ? (
        <button
          type="button"
          onClick={onWithdraw}
          className="shrink-0 h-9 px-4 rounded-xl text-sm font-semibold border border-white/20 text-white hover:bg-white/5 active:scale-[0.97] transition-all"
        >
          Withdraw →
        </button>
      ) : (
        <div className="shrink-0 flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
          <span className="text-sm font-medium">Clear</span>
        </div>
      )}
    </div>
  );
}
