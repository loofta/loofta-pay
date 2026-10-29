"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy } from "lucide-react";
import { WalletModal } from "@/components/wallet/WalletModal";
import { BTN_SECONDARY, shortAddress } from "@/components/wallet/walletStyles";

const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";

type Net = "solana" | "evm";

export function WalletReceiveModal({ open, onClose, solanaAddress, evmAddress }: { open: boolean; onClose: () => void; solanaAddress: string | null; evmAddress: string | null }) {
  const router = useRouter();
  const t = useTranslations("Wallet");
  const [net, setNet] = useState<Net>("solana");
  const [copied, setCopied] = useState(false);
  const address = net === "solana" ? solanaAddress : evmAddress;

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <WalletModal open={open} onClose={onClose} title={t("common.receive")}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div role="group" aria-label={t("receive.network")} style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 999, background: "#0E0E12" }}>
          {(["solana", "evm"] as Net[]).map((n) => (
            <button key={n} type="button" onClick={() => { setNet(n); setCopied(false); }} aria-pressed={net === n} style={{ cursor: "pointer", padding: 10, borderRadius: 999, border: 0, fontWeight: 700, fontSize: 14, background: net === n ? "#26262E" : "transparent", color: net === n ? "#F2EFE8" : "#77757F" }}>
              {n === "solana" ? "Solana" : "EVM"}
            </button>
          ))}
        </div>

        {address ? (
          <>
            <div style={{ padding: 14, borderRadius: 24, background: "#fff" }}>
              <QRCodeSVG value={address} size={200} bgColor="#ffffff" fgColor="#0B0B0E" />
            </div>
            <span style={{ fontSize: 15, lineHeight: 1.5, color: "#9A98A3", textAlign: "center" }}>
              {net === "solana" ? t("receive.solanaHint") : t("receive.evmHint")}
            </span>
            <button type="button" onClick={copy} aria-label={t("receive.copy")} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 999, border: 0, background: "#1A1A20", color: "#C9C6CF" }}>
              <span style={{ fontFamily: MONO, fontSize: 15 }}>{shortAddress(address)}</span>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </>
        ) : (
          <span style={{ fontSize: 15, color: "#9A98A3", padding: "40px 0" }}>{t("receive.noAddress", { network: net === "solana" ? "Solana" : "EVM" })}</span>
        )}

        <button type="button" onClick={() => { onClose(); router.push("/app/receive"); }} className="lh-8" style={{ cursor: "pointer", width: "100%", boxSizing: "border-box", textAlign: "left", display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, background: "linear-gradient(135deg,rgba(255,90,26,0.12),#141419 60%)", border: "1px solid rgba(255,138,74,0.35)", color: "#F2EFE8", marginTop: "auto" }}>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 16, letterSpacing: "-0.02em" }}>{t("receive.linkTitle")}</span>
            <span style={{ fontSize: 14, lineHeight: 1.45, color: "#9A98A3" }}>{t("receive.linkSub")}</span>
          </span>
          <span style={{ fontSize: 20, color: "#5D5B66" }}>→</span>
        </button>
        <button type="button" onClick={onClose} style={{ ...BTN_SECONDARY, flex: "none", width: "100%" }}>{t("common.close")}</button>
      </div>
    </WalletModal>
  );
}
