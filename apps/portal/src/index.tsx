import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

export type PortalTheme = {
  background?: string;
  surface?: string;
  border?: string;
  text?: string;
  muted?: string;
  accent?: string;
  accentText?: string;
  radius?: number;
  fontFamily?: string;
};

export type PayoutPortalProps = {
  /**
   * Fetch a widget token from YOUR server (which calls Loofta's POST /partner-portal/token with
   * your API key and the signed-in user's email, handle or id). Called on mount and again if the
   * token expires. Never put your API key in the browser.
   */
  getToken: () => Promise<string>;
  /** Defaults to Loofta's public portal API. */
  apiBase?: string;
  theme?: PortalTheme;
  /** Called when the user taps Withdraw, before they are sent to Loofta. Return false to cancel. */
  onWithdraw?: (info: { url: string; availableUsd: number }) => boolean | void;
  className?: string;
};

type HistoryItem = { amount: number; message: string | null; received_at: string; state: "available" | "withdrawn" };

type PortalData = {
  partner: { name: string | null; logo_url: string | null; brand_color: string | null };
  available_usd: number;
  withdrawn_usd: number;
  min_withdraw_usd: number;
  withdraw_url: string;
  return_url: string | null;
  history: HistoryItem[];
};

const DEFAULT_API = "https://pay.loofta.xyz/api/portal";
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Shows what a user received from you and lets them withdraw it. Withdrawing happens on a Loofta
 * page branded with your logo, where they sign in as the email or handle you paid. Uses inline
 * styles only, so it needs no CSS file and no Tailwind, and takes colours from the `theme` prop.
 */
export function PayoutPortal({ getToken, apiBase = DEFAULT_API, theme, onWithdraw, className }: PayoutPortalProps) {
  const t = {
    background: "transparent",
    surface: "#17171b",
    border: "rgba(255,255,255,0.12)",
    text: "#f1f5f9",
    muted: "#94a3b8",
    accent: "#FF5A1A",
    accentText: "#ffffff",
    radius: 16,
    fontFamily: "inherit",
    ...theme,
  };
  const token = useRef<string | null>(null);
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (retry = true): Promise<void> => {
      try {
        if (!token.current) token.current = await getToken();
        const res = await fetch(`${apiBase}/me`, { headers: { Authorization: `Bearer ${token.current}` } });
        if (res.status === 401 && retry) {
          token.current = null;
          return load(false);
        }
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Could not load your payouts.");
        setData((await res.json()) as PortalData);
        setError(null);
      } catch (e) {
        setError((e as Error).message || "Could not load your payouts.");
      }
    },
    [apiBase, getToken],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const box: CSSProperties = { background: t.background, color: t.text, fontFamily: t.fontFamily, fontSize: 16, lineHeight: 1.5 };
  const card: CSSProperties = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: t.radius, padding: 20 };

  if (error) return <div className={className} style={{ ...box, ...card, color: t.muted }}>{error}</div>;
  if (!data) return <div className={className} style={{ ...box, color: t.muted }}>Loading...</div>;

  const canWithdraw = data.available_usd > 0 && data.available_usd >= data.min_withdraw_usd;
  const withdraw = () => {
    if (onWithdraw?.({ url: data.withdraw_url, availableUsd: data.available_usd }) === false) return;
    window.location.href = data.withdraw_url;
  };

  return (
    <div className={className} style={box}>
      <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: t.muted, fontSize: 16 }}>Ready to withdraw</div>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>{usd(data.available_usd)}</div>
          {data.min_withdraw_usd > data.available_usd && data.available_usd > 0 && (
            <div style={{ color: t.muted, fontSize: 16 }}>Minimum withdrawal {usd(data.min_withdraw_usd)}</div>
          )}
        </div>
        <button
          type="button"
          onClick={withdraw}
          disabled={!canWithdraw}
          style={{
            background: t.accent,
            color: t.accentText,
            border: 0,
            borderRadius: 999,
            padding: "12px 26px",
            fontSize: 17,
            fontWeight: 600,
            cursor: canWithdraw ? "pointer" : "not-allowed",
            opacity: canWithdraw ? 1 : 0.5,
          }}
        >
          Withdraw
        </button>
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <strong>Payouts received</strong>
          <span style={{ color: t.muted }}>Withdrawn {usd(data.withdrawn_usd)}</span>
        </div>
        {data.history.length === 0 ? (
          <div style={{ color: t.muted }}>Nothing received yet.</div>
        ) : (
          data.history.map((h, i) => (
            <div
              key={i}
              style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${t.border}` : 0 }}
            >
              <div>
                <div>{h.message || "Payout"}</div>
                <div style={{ color: t.muted }}>{new Date(h.received_at).toLocaleDateString()}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div>{usd(h.amount)}</div>
                <div style={{ color: h.state === "withdrawn" ? t.muted : t.accent }}>{h.state === "withdrawn" ? "Withdrawn" : "Ready"}</div>
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ color: t.muted, fontSize: 16, marginTop: 10 }}>Payouts powered by Loofta</div>
    </div>
  );
}

/** Same component under the shorter name used in the docs: `<Payouts getToken={...} />`. */
export const Payouts = PayoutPortal;
