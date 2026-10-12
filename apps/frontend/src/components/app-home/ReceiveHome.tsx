"use client";

import { useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth";
import { SendReceiveTabs } from "@/components/app/SendReceiveTabs";
import { sora, manrope, jetbrainsMono } from "@/components/home-v4/fonts";
import "./loofta-app.css";

const SORA = "var(--font-home-sora), Sora, sans-serif";

export function ReceiveHome() {
  const { authenticated, login } = useAuth();
  const username = useAuthStore((s) => s.username);
  const [copied, setCopied] = useState(false);
  const handle = username?.replace(/^@/, "") || "";
  const link = handle ? `https://pay.loofta.xyz/@${handle}` : "";

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`loofta-app ${sora.variable} ${manrope.variable} ${jetbrainsMono.variable}`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif", color: "#F2EFE8", maxWidth: 600, margin: "0 auto", padding: "12px 20px 80px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 16 }}>
      <SendReceiveTabs activeTab="receive" />

      <div style={{ padding: 36, borderRadius: 30, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em" }}>Your personal link</span>
          <span style={{ fontSize: 15, lineHeight: 1.5, color: "#9A98A3" }}>Anyone can pay you by opening this link. You receive in USDC on Solana.</span>
        </div>
        {authenticated && link ? (
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "none", padding: 12, borderRadius: 20, background: "#fff" }}>
              <QRCodeSVG value={link} size={126} bgColor="#ffffff" fgColor="#0B0B0E" />
            </div>
            <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 14px", borderRadius: 14, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-home-mono), ui-monospace, monospace", fontSize: 14 }}>{link.replace("https://", "")}</span>
                <button type="button" onClick={copy} style={{ flex: "none", padding: "9px 14px", borderRadius: 10, background: "#22222A", border: 0, color: "#F2EFE8", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{copied ? "Copied" : "Copy"}</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                <button type="button" onClick={() => useAuthStore.getState().setOpenShareModal(true)} style={{ cursor: "pointer", textAlign: "center", padding: 12, borderRadius: 14, background: "#22222A", border: "1px solid rgba(255,255,255,0.08)", fontWeight: 700, fontSize: 14, color: "#F2EFE8" }}>Share</button>
                <button type="button" onClick={() => useAuthStore.getState().setOpenSettingsModal(true)} style={{ cursor: "pointer", textAlign: "center", padding: 12, borderRadius: 14, background: "#22222A", border: "1px solid rgba(255,255,255,0.08)", fontWeight: 700, fontSize: 14, color: "#F2EFE8" }}>Settings</button>
              </div>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => login()} style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "18px 24px", borderRadius: 18, border: 0, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: 600, fontSize: 16 }}>Sign in to get your link</button>
        )}
      </div>

      <div style={{ padding: 36, borderRadius: 30, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em" }}>Request a payment</span>
          <span style={{ fontSize: 15, lineHeight: 1.5, color: "#9A98A3" }}>Create a one-off payment request. You choose the amount. No account required for the person paying.</span>
        </div>
        <Link href="/app/send?create=1" style={{ display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "18px 28px", borderRadius: 18, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: 600, fontSize: 16 }}>Create payment link</Link>
      </div>
    </div>
  );
}
