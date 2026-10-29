"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD_BOX, FIELD_INPUT } from "@/components/wallet/walletStyles";

const SORA = "var(--font-home-sora), Sora, sans-serif";
const PRESETS = [10, 50, 100, 300];
const MIN_BPS = 10;
const MAX_BPS = 1000;

export const LOW_SLIPPAGE_BPS = 30;
export const HIGH_SLIPPAGE_BPS = 300;

export function formatSlippage(bps: number): string {
  return `${(bps / 100).toFixed(bps % 10 === 0 ? (bps % 100 === 0 ? 0 : 1) : 2)}%`;
}

/** Slippage tolerance sheet: presets or a custom percentage, with a warning when it is risky. */
export function SlippageSettings({ value, onSave, onCancel }: { value: number; onSave: (bps: number) => void; onCancel: () => void }) {
  const t = useTranslations("Wallet");
  const [bps, setBps] = useState(value);
  const [custom, setCustom] = useState(PRESETS.includes(value) ? "" : String(value / 100));

  const setFromCustom = (text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, "");
    setCustom(cleaned);
    const pct = Number(cleaned);
    if (cleaned && Number.isFinite(pct)) setBps(Math.round(pct * 100));
  };
  const valid = bps >= MIN_BPS && bps <= MAX_BPS;
  const low = valid && bps < LOW_SLIPPAGE_BPS;
  const high = valid && bps >= HIGH_SLIPPAGE_BPS;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "6px 0 2px" }}>
        <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 40, letterSpacing: "-0.04em" }}>{valid ? formatSlippage(bps) : "-"}</span>
        <span style={{ fontSize: 14, color: "#77757F" }}>{t("slippage.hint")}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => { setBps(p); setCustom(""); }} aria-pressed={bps === p && !custom} style={{ cursor: "pointer", padding: "12px 0", borderRadius: 14, border: 0, fontWeight: 700, fontSize: 15, background: bps === p && !custom ? "#2E2E37" : "#1A1A20", color: "#F2EFE8" }}>
            {formatSlippage(p)}
          </button>
        ))}
      </div>

      <div style={FIELD_BOX}>
        <input inputMode="decimal" value={custom} onChange={(e) => setFromCustom(e.target.value)} placeholder={t("slippage.custom")} aria-label={t("slippage.customAria")} style={FIELD_INPUT} />
        <span style={{ fontSize: 15, color: "#9A98A3", fontWeight: 700 }}>%</span>
      </div>

      {!valid && <span style={{ fontSize: 14, color: "#FF7A6A", padding: "0 6px" }}>Enter between {formatSlippage(MIN_BPS)} and {formatSlippage(MAX_BPS)}.</span>}
      {low && <span style={{ fontSize: 14, lineHeight: 1.5, color: "#F5D547", padding: "0 6px" }}>{t("slippage.low")}</span>}
      {high && <span style={{ fontSize: 14, lineHeight: 1.5, color: "#F5D547", padding: "0 6px" }}>{t("slippage.high")}</span>}
      <span style={{ fontSize: 14, lineHeight: 1.5, color: "#77757F", padding: "0 6px" }}>
        {t("slippage.note")}
      </span>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: "auto" }}>
        <button type="button" onClick={onCancel} style={BTN_SECONDARY}>{t("common.cancel")}</button>
        <button type="button" onClick={() => valid && onSave(bps)} disabled={!valid} style={{ ...BTN_PRIMARY, opacity: valid ? 1 : 0.4 }}>{t("common.save")}</button>
      </div>
    </div>
  );
}
