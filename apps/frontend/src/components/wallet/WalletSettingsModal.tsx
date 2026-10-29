"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useExportWallet as useExportEvmWallet } from "@privy-io/react-auth";
import { useExportWallet as useExportSolanaWallet } from "@privy-io/react-auth/solana";
import { KeyRound } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { WalletModal } from "@/components/wallet/WalletModal";
import { BTN_SECONDARY } from "@/components/wallet/walletStyles";

const SORA = "var(--font-home-sora), Sora, sans-serif";

/** Wallet settings. Export opens Privy's own secure window, so the key is never visible to Loofta. */
export function WalletSettingsModal({
  open,
  onClose,
  solanaAddress,
  evmAddress,
}: {
  open: boolean;
  onClose: () => void;
  solanaAddress: string | null;
  evmAddress: string | null;
}) {
  const { toast } = useToast();
  const t = useTranslations("Wallet");
  const { exportWallet: exportSolana } = useExportSolanaWallet();
  const { exportWallet: exportEvm } = useExportEvmWallet();
  const [busy, setBusy] = useState<"solana" | "evm" | null>(null);

  const run = async (which: "solana" | "evm") => {
    const address = which === "solana" ? solanaAddress : evmAddress;
    if (!address) return;
    setBusy(which);
    // Close our sheet first so Privy's export window is not stacked underneath it.
    onClose();
    try {
      if (which === "solana") await exportSolana({ address });
      else await exportEvm({ address });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!/closed|cancel|exit/i.test(msg)) {
        toast({ variant: "destructive", title: t("settings.exportUnavailable"), description: msg || t("settings.exportUnavailableBody") });
      }
    } finally {
      setBusy(null);
    }
  };

  const options: Array<{ key: "solana" | "evm"; title: string; sub: string; address: string | null }> = [
    { key: "solana", title: t("settings.exportSolana"), sub: t("settings.exportSolanaSub"), address: solanaAddress },
    { key: "evm", title: t("settings.exportEvm"), sub: t("settings.exportEvmSub"), address: evmAddress },
  ];

  return (
    <WalletModal open={open} onClose={onClose} title={t("home.settings")}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        {options.map((o) => (
          <button key={o.key} type="button" onClick={() => void run(o.key)} disabled={!o.address || busy !== null} className="lh-9" style={{ cursor: o.address ? "pointer" : "default", display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 20, background: "#1A1A20", border: "1px solid rgba(255,255,255,0.07)", color: "#F2EFE8", textAlign: "left", opacity: o.address ? 1 : 0.5 }}>
            <span style={{ flex: "none", width: 40, height: 40, borderRadius: 13, background: "#2A2A32", display: "grid", placeItems: "center" }}>
              <KeyRound size={20} color="#FF8A4A" />
            </span>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 16 }}>{o.title}</span>
              <span style={{ fontSize: 14, color: "#77757F" }}>{o.address ? o.sub : t("settings.noWallet")}</span>
            </span>
            <span style={{ fontSize: 20, color: "#5D5B66" }}>→</span>
          </button>
        ))}
        <span style={{ fontSize: 14, lineHeight: 1.5, color: "#77757F", padding: "4px 6px" }}>
          Export shows your private key in a secure Privy window so you can import the wallet into another app. Anyone with the key controls the funds, so never share it.
        </span>
        <button type="button" onClick={onClose} style={{ ...BTN_SECONDARY, flex: "none", width: "100%", marginTop: "auto" }}>{t("common.close")}</button>
      </div>
    </WalletModal>
  );
}
