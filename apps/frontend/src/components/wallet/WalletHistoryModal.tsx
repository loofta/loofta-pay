"use client";

import { useLocale, useTranslations } from "next-intl";
import { WalletModal } from "@/components/wallet/WalletModal";
import { useWalletActivity, type ActivityItem, type ActivityKind } from "@/hooks/useWalletActivity";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import { shortAddress } from "@/components/wallet/walletStyles";

const WSOL = "So11111111111111111111111111111111111111112";
const MONO = "var(--font-home-mono), ui-monospace, monospace";

const ICONS: Record<ActivityKind, { bg: string; color: string; glyph: string }> = {
  sent: { bg: "rgba(255,90,26,0.14)", color: "#FF7A2A", glyph: "↑" },
  received: { bg: "rgba(60,179,113,0.14)", color: "#6FD69A", glyph: "↓" },
  swap: { bg: "rgba(39,117,202,0.18)", color: "#8FB4FF", glyph: "⇄" },
  bridge: { bg: "rgba(245,183,12,0.14)", color: "#F5B70C", glyph: "⛓" },
};

function when(at: number | null, t: (key: string, values?: Record<string, string>) => string, locale: string): string {
  if (!at) return "";
  const d = new Date(at * 1000);
  const now = new Date();
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return t("history.today", { time });
  if (days === 1) return t("history.yesterday", { time });
  if (days < 7) return `${d.toLocaleDateString(locale, { weekday: "short" })}, ${time}`;
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

const amountText = (n: number) => new Intl.NumberFormat("en-US", { notation: n >= 1_000_000 ? "compact" : "standard", maximumSignificantDigits: 6 }).format(n);

export function WalletHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Wallet");
  const locale = useLocale();
  const { data, isLoading, isError } = useWalletActivity(open);
  const sym = (mint?: string) => (mint ? (mint === WSOL ? "SOL" : data?.tokens[mint]?.symbol ?? `${mint.slice(0, 4)}...`) : "");

  const row = (it: ActivityItem) => {
    const icon = ICONS[it.kind];
    const cp = it.counterparty ? shortAddress(it.counterparty) : "";
    let title = "";
    let right = "";
    let rightColor = "#F2EFE8";
    if (it.kind === "swap") {
      title = t("history.swapped", { from: sym(it.out?.mint), to: sym(it.into?.mint) });
      right = `+${amountText(it.into?.amount ?? 0)} ${sym(it.into?.mint)}`;
    } else if (it.kind === "bridge") {
      title = t("history.bridged", { token: sym(it.out?.mint) });
      right = `−${amountText(it.out?.amount ?? 0)} ${sym(it.out?.mint)}`;
    } else if (it.kind === "sent") {
      title = it.private && !cp ? t("history.sentPrivately") : cp ? t("history.sentTo", { name: cp }) : t("history.sent");
      right = `−${amountText(it.out?.amount ?? 0)} ${sym(it.out?.mint)}`;
    } else {
      title = cp ? t("history.receivedFrom", { name: cp }) : t("history.received");
      right = `+${amountText(it.into?.amount ?? 0)} ${sym(it.into?.mint)}`;
      rightColor = "#6FD69A";
    }
    const sub = [when(it.at, t, locale), it.kind === "swap" ? (it.label ?? "") : it.kind === "bridge" ? t("history.crossChain") : ""].filter(Boolean).join(" · ");
    return (
      <a key={it.signature} href={getExplorerTxUrl("solana", it.signature)} target="_blank" rel="noreferrer" className="lh-9" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 8px", borderRadius: 16, color: "#F2EFE8", textDecoration: "none" }}>
        <div style={{ flex: "none", width: 42, height: 42, borderRadius: 14, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 18, background: icon.bg, color: icon.color }}>{icon.glyph}</div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15, fontFamily: cp ? undefined : undefined }}>{title}</span>
            {it.private && <span style={{ padding: "2px 7px", borderRadius: 999, background: "rgba(255,122,42,0.12)", fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: "#FF8A4A" }}>{t("history.private")}</span>}
          </div>
          <span style={{ fontSize: 13, color: "#77757F" }}>{sub}</span>
        </div>
        <span style={{ fontWeight: 600, fontSize: 15, color: rightColor, textAlign: "right" }}>{right}</span>
      </a>
    );
  };

  return (
    <WalletModal open={open} onClose={onClose} title={t("common.history")}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {isLoading && <span style={{ fontSize: 14, color: "#77757F", padding: "8px 6px" }}>{t("history.loading")}</span>}
        {isError && <span style={{ fontSize: 14, color: "#FF7A6A", padding: "8px 6px" }}>{t("history.error")}</span>}
        {data && data.items.length === 0 && <span style={{ fontSize: 14, color: "#77757F", padding: "8px 6px" }}>{t("history.empty")}</span>}
        {data?.items.map(row)}
      </div>
    </WalletModal>
  );
}
