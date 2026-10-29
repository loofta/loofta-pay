"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { WalletHolding } from "@/hooks/useWalletHoldings";
import { WalletModal } from "@/components/wallet/WalletModal";
import { WalletSwap } from "@/components/wallet/WalletSwap";
import { JupiterSwap, holdingToPick } from "@/components/wallet/JupiterSwap";
import { JupiterTokenPicker, type PickToken } from "@/components/wallet/JupiterTokenPicker";
import { SlippageSettings } from "@/components/wallet/SlippageSettings";

const SLIPPAGE_KEY = "loofta:swapSlippageBps";
const DEFAULT_SLIPPAGE_BPS = 50;

function readSlippage(): number {
  try {
    const n = Number(localStorage.getItem(SLIPPAGE_KEY));
    return Number.isInteger(n) && n >= 10 && n <= 1000 ? n : DEFAULT_SLIPPAGE_BPS;
  } catch {
    return DEFAULT_SLIPPAGE_BPS;
  }
}

type Tab = "solana" | "cross";

/** Swap sheet: "Solana swap" runs on Jupiter (0.80% fee), "Cross-chain" runs confidentially on NEAR Intents. */
export function WalletSwapModal({
  open,
  onClose,
  holdings,
  solanaAddress,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  holdings: WalletHolding[];
  solanaAddress: string | null;
  onDone?: () => void;
}) {
  const tr = useTranslations("Wallet");
  const [tab, setTab] = useState<Tab>("solana");
  const [picker, setPicker] = useState<"pay" | "get" | "slippage" | null>(null);
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);

  useEffect(() => {
    if (open) setSlippageBps(readSlippage());
  }, [open]);
  const [pay, setPay] = useState<PickToken | null>(null);
  const [get, setGet] = useState<PickToken | null>(null);

  const yours = useMemo(() => holdings.filter((h) => h.amount > 0).map(holdingToPick), [holdings]);

  useEffect(() => {
    if (!open) {
      setPicker(null);
      setGet(null);
      setPay(null);
      setTab("solana");
    }
  }, [open]);

  // Default to the token you hold the most of.
  useEffect(() => {
    if (open && !pay && yours.length > 0) setPay(yours[0]);
  }, [open, pay, yours]);

  const onSetGet = useCallback((t: PickToken) => setGet(t), []);

  const title = picker === "pay" ? tr("swap.youPay") : picker === "get" ? tr("swap.youGet") : picker === "slippage" ? tr("swap.slippage") : tr("common.swap");
  return (
    <WalletModal open={open} onClose={onClose} title={title} onBack={picker ? () => setPicker(null) : null}>
      {picker === "slippage" ? (
        <SlippageSettings
          value={slippageBps}
          onCancel={() => setPicker(null)}
          onSave={(bps) => {
            setSlippageBps(bps);
            try { localStorage.setItem(SLIPPAGE_KEY, String(bps)); } catch { /* per-viewer convenience only */ }
            setPicker(null);
          }}
        />
      ) : picker ? (
        <JupiterTokenPicker
          yours={yours}
          yoursOnly={picker === "pay"}
          exclude={picker === "pay" ? get?.mint : pay?.mint}
          onPick={(t) => {
            if (picker === "pay") setPay(t);
            else setGet(t);
            setPicker(null);
          }}
        />
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <div role="group" aria-label={tr("swap.type")} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 999, background: "#0E0E12" }}>
            {([["solana", tr("swap.tabSolana")], ["cross", tr("swap.tabCross")]] as Array<[Tab, string]>).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setTab(m)} aria-pressed={tab === m} style={{ cursor: "pointer", padding: 10, borderRadius: 999, border: 0, fontWeight: 700, fontSize: 14, background: tab === m ? "#26262E" : "transparent", color: tab === m ? "#F2EFE8" : "#77757F" }}>{label}</button>
            ))}
          </div>
          {tab === "solana" ? (
            <JupiterSwap holdings={holdings} solanaAddress={solanaAddress} pay={pay} get={get} onOpenPicker={setPicker} onSetGet={onSetGet} slippageBps={slippageBps} onOpenSlippage={() => setPicker("slippage")} onClose={onClose} onDone={onDone} />
          ) : (
            <WalletSwap onClose={onClose} onDone={onDone} />
          )}
        </div>
      )}
    </WalletModal>
  );
}
