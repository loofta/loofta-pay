"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Settings } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWalletHoldings } from "@/hooks/useWalletHoldings";
import { WalletTokenLogo } from "@/components/wallet/WalletTokenLogo";
import { WalletSendModal } from "@/components/wallet/WalletSendModal";
import { WalletReceiveModal } from "@/components/wallet/WalletReceiveModal";
import { WalletSwapModal } from "@/components/wallet/WalletSwapModal";
import { WalletSettingsModal } from "@/components/wallet/WalletSettingsModal";
import { WalletNfts } from "@/components/wallet/WalletNfts";
import { WalletHistoryModal } from "@/components/wallet/WalletHistoryModal";
import { sora, manrope, jetbrainsMono } from "@/components/home-v4/fonts";
import "@/components/app-home/loofta-app.css";

const SORA = "var(--font-home-sora), Sora, sans-serif";

type Panel = "send" | "receive" | "swap" | "history";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shine = (rim: string) => `inset 0 3px 6px rgba(255,255,255,0.5),inset 0 -6px 10px rgba(0,0,0,0.2),0 6px 0 ${rim},0 16px 28px rgba(0,0,0,0.45)`;
const grad = (a: string, b: string, c: string) => `radial-gradient(120% 120% at 28% 18%,${a} 0%,${b} 50%,${c} 100%)`;

function WalletHomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authenticated, login } = useAuth();
  const { holdings, totalUsd, unpriced, isLoading, refetch, address, evmAddress } = useWalletHoldings();
  const [listTab, setListTab] = useState<"tokens" | "nfts">("tokens");
  const live = authenticated && !isLoading;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const tabParam = searchParams.get("tab");
  const [panel, setPanel] = useState<Panel | null>(tabParam === "send" || tabParam === "receive" || tabParam === "swap" || tabParam === "history" ? tabParam : null);

  useEffect(() => {
    if (tabParam === "send" || tabParam === "receive" || tabParam === "swap" || tabParam === "history") setPanel(tabParam);
  }, [tabParam]);

  const open = useCallback(
    (p: Panel | null) => {
      setPanel(p);
      router.replace(p ? `/app/wallet?tab=${p}` : "/app/wallet", { scroll: false });
    },
    [router],
  );

  const requireAuth = (fn: () => void) => () => (authenticated ? fn() : login());
  const actions = [
    { label: "Send", glyph: "↑", bg: grad("#FFC79A", "#FF5A1A", "#D23806"), shadow: shine("#9C2802"), ink: "#fff", go: requireAuth(() => open("send")) },
    { label: "Receive", glyph: "↓", bg: grad("#FFFFFF", "#E6E4EC", "#B8B5C2"), shadow: shine("#7D7A88"), ink: "#1A1A20", go: requireAuth(() => open("receive")) },
    { label: "Swap", glyph: "⇄", bg: grad("#9CC8FF", "#2775CA", "#1A55A0"), shadow: shine("#123E78"), ink: "#fff", go: requireAuth(() => open("swap")) },
    { label: "History", glyph: "◷", bg: grad("#FFF0B8", "#F5B70C", "#D17A04"), shadow: shine("#8E5202"), ink: "#6A3500", go: requireAuth(() => open("history")) },
  ];
  const shownHoldings = holdings.filter((h) => h.amount > 0);

  return (
    <div
      className={`loofta-app ${sora.variable} ${manrope.variable} ${jetbrainsMono.variable} min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12]`}
      style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif", color: "#F2EFE8" }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "clamp(20px,4vw,40px) 20px 48px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ position: "relative", overflow: "hidden", padding: "clamp(18px, 5vw, 30px)", borderRadius: 32, background: "linear-gradient(160deg,#1C1C24,#121217)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 26 }}>
          <div style={{ position: "absolute", right: -80, top: -80, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,90,26,0.26),rgba(255,90,26,0) 70%)" }} />
          {authenticated && (
            <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Wallet settings" style={{ position: "absolute", top: 20, right: 20, zIndex: 1, cursor: "pointer", width: 44, height: 44, borderRadius: 999, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(10,10,13,0.5)", color: "#C9C6CF", display: "grid", placeItems: "center" }}>
              <Settings size={20} />
            </button>
          )}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: "clamp(46px,9vw,68px)", letterSpacing: "-0.05em", lineHeight: 1 }}>
              {authenticated ? (live ? money(totalUsd) : "…") : money(0)}
            </span>
            {unpriced && live && <span style={{ fontSize: 14, color: "#77757F" }}>Some tokens have no price yet and are not counted in the total.</span>}
          </div>

          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "clamp(8px, 2.4vw, 10px)" }}>
            {actions.map((a) => (
              <button key={a.label} type="button" onClick={a.go} className="lh-9" style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(10px, 3vw, 14px)", padding: "clamp(14px, 4vw, 20px) 4px clamp(12px, 3.4vw, 16px)", borderRadius: "clamp(18px, 5vw, 22px)", background: "rgba(10,10,13,0.5)", border: "1px solid rgba(255,255,255,0.07)", color: "#F2EFE8" }}>
                <div style={{ width: "clamp(46px, 13.5vw, 56px)", height: "clamp(46px, 13.5vw, 56px)", borderRadius: "clamp(15px, 4.5vw, 18px)", background: a.bg, boxShadow: a.shadow, display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: 800, fontSize: 26, color: a.ink }}>{a.glyph}</div>
                <span style={{ fontWeight: 700, fontSize: "clamp(13px, 3.6vw, 14px)" }}>{a.label}</span>
              </button>
            ))}
          </div>

          {!authenticated && (
            <button type="button" onClick={() => login()} style={{ position: "relative", cursor: "pointer", padding: "18px 24px", borderRadius: 18, border: 0, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: 600, fontSize: 16 }}>
              Sign in to see your wallet
            </button>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "clamp(12px, 3.5vw, 16px)", borderRadius: 28, background: "linear-gradient(135deg,rgba(245,183,12,0.10),#141115 60%)", border: "1px solid rgba(245,183,12,0.28)" }}>
            <div style={{ flex: "none", width: 52, height: 52, borderRadius: 17, background: grad("#FFF0B8", "#F5B70C", "#D17A04"), boxShadow: shine("#8E5202"), display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: 800, fontSize: 24, color: "#6A3500" }}>+</div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em" }}>Add funds</span>
              <span style={{ fontSize: 14, lineHeight: 1.4, color: "#9A98A3" }}>Card, bank or Apple Pay</span>
            </div>
            <button type="button" onClick={requireAuth(() => window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab: "topup" } })))} style={{ cursor: "pointer", flex: "none", padding: "12px 20px", borderRadius: 14, border: 0, background: "#F5B70C", color: "#2A1A00", fontFamily: SORA, fontWeight: 700, fontSize: 15 }}>Buy</button>
          </div>

          <button type="button" onClick={requireAuth(() => router.push("/app/send"))} className="lh-8" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "clamp(12px, 3.5vw, 16px)", borderRadius: 28, textAlign: "left", background: "linear-gradient(135deg,rgba(255,90,26,0.10),#141115 60%)", border: "1px solid rgba(255,138,74,0.30)", color: "#F2EFE8" }}>
            <div style={{ flex: "none", width: 52, height: 52, borderRadius: 17, background: grad("#FFC79A", "#FF5A1A", "#D23806"), boxShadow: shine("#9C2802"), display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: 800, fontSize: 24, color: "#fff" }}>@</div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em" }}>Send $ to a username</span>
              <span style={{ fontSize: 14, lineHeight: 1.4, color: "#9A98A3" }}>No address needed. Go to Send & Receive</span>
            </div>
            <span style={{ flex: "none", fontSize: 22, color: "#FF7A2A" }}>→</span>
          </button>
        </div>

        <div style={{ padding: "24px 18px 18px", borderRadius: 32, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div role="group" aria-label="Wallet assets" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 999, background: "#0E0E12", marginBottom: 6 }}>
            {(["tokens", "nfts"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setListTab(t)} aria-pressed={listTab === t} style={{ cursor: "pointer", padding: 10, borderRadius: 999, border: 0, fontFamily: SORA, fontWeight: 700, fontSize: 15, background: listTab === t ? "#26262E" : "transparent", color: listTab === t ? "#F2EFE8" : "#77757F" }}>
                {t === "tokens" ? "Tokens" : "NFTs"}
              </button>
            ))}
          </div>
          {listTab === "nfts" && <WalletNfts enabled={authenticated} solanaAddress={address} />}
          {listTab === "tokens" && authenticated && !live && <span style={{ fontSize: 14, color: "#77757F", padding: "0 8px" }}>Loading your tokens…</span>}
          {listTab === "tokens" && shownHoldings.map((h) => (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 20, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.05)" }}>
              <WalletTokenLogo symbol={h.symbol} chain={h.chain} logo={h.logo} mint={h.mint} size={44} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                <span style={{ fontSize: 14, color: "#77757F" }}>{h.amount.toLocaleString("en-US", { maximumFractionDigits: h.decimals > 4 ? 5 : 2 })} {h.symbol}</span>
              </div>
              <span style={{ fontFamily: SORA, fontWeight: 600, fontSize: 16 }}>{h.usd != null ? money(h.usd) : "No price"}</span>
            </div>
          ))}
          {listTab === "tokens" && authenticated && live && shownHoldings.length === 0 && <span style={{ fontSize: 14, color: "#77757F", padding: "0 8px 6px" }}>Nothing here yet. Tap Receive to get your address.</span>}
        </div>
      </div>

      <WalletSendModal open={authenticated && panel === "send"} onClose={() => open(null)} holdings={holdings} solanaAddress={address} onUseSwap={() => open("swap")} onDone={() => void refetch()} />
      <WalletHistoryModal open={authenticated && panel === "history"} onClose={() => open(null)} />
      <WalletSettingsModal open={authenticated && settingsOpen} onClose={() => setSettingsOpen(false)} solanaAddress={address} evmAddress={evmAddress} />
      <WalletReceiveModal open={authenticated && panel === "receive"} onClose={() => open(null)} solanaAddress={address} evmAddress={evmAddress} />
      <WalletSwapModal open={authenticated && panel === "swap"} onClose={() => open(null)} holdings={holdings} solanaAddress={address} onDone={() => void refetch()} />
    </div>
  );
}

export function WalletHome() {
  return (
    <Suspense fallback={null}>
      <WalletHomeInner />
    </Suspense>
  );
}
