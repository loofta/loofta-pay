import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

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
   * Fetch a portal token from YOUR server (which calls Loofta's POST /payouts/portal-token with
   * your API key and the signed-in user's id). Called on mount and again if the token expires.
   * Never put your API key in the browser.
   */
  getToken: () => Promise<string>;
  /** Defaults to Loofta's public portal API. */
  apiBase?: string;
  theme?: PortalTheme;
  /** Called after a withdrawal request finishes. */
  onWithdraw?: (result: { sent: number; failed: number }) => void;
  className?: string;
};

type HistoryItem = {
  payment_id: string;
  amount: number;
  message: string | null;
  created_at: string;
  state: "processing" | "available" | "withdrawn";
};

type PortalData = {
  partner: { name: string | null; logo_url: string | null };
  available_usd: number;
  processing_usd: number;
  history: HistoryItem[];
};

const DEFAULT_API = "https://pay.loofta.xyz/api/portal";
const STATE_LABEL: Record<HistoryItem["state"], string> = {
  processing: "Processing",
  available: "Ready to withdraw",
  withdrawn: "Withdrawn",
};
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Payout portal that renders inside your own page. Uses inline styles only, so it needs no CSS
 * file and no Tailwind, and takes colors from the `theme` prop to match your app.
 */
export function PayoutPortal({ getToken, apiBase = DEFAULT_API, theme, onWithdraw, className }: PayoutPortalProps) {
  const t = { background: "transparent", surface: "#17171b", border: "rgba(255,255,255,0.15)", text: "#f1f5f9", muted: "#94a3b8", accent: "#EAB308", accentText: "#111114", radius: 16, fontFamily: "inherit", ...theme };
  const token = useRef<string | null>(null);
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const call = useCallback(
    async (path: string, init?: RequestInit, retried = false): Promise<any> => {
      if (!token.current) token.current = await getToken();
      const res = await fetch(`${apiBase.replace(/\/$/, "")}/${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.current}` },
      });
      if (res.status === 401 && !retried) {
        token.current = null; // expired: ask the partner server for a fresh one, once
        return call(path, init, true);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Something went wrong.");
      return body;
    },
    [getToken, apiBase],
  );

  const load = useCallback(async () => {
    try {
      setData(await call("me"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load payouts.");
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  const available = data?.available_usd ?? 0;
  const walletValid = useMemo(() => SOLANA_ADDRESS.test(wallet.trim()), [wallet]);

  async function withdraw() {
    setBusy(true);
    setNotice(null);
    try {
      const out = await call("withdraw", { method: "POST", body: JSON.stringify({ destination_address: wallet.trim() }) });
      const results = out.results as Array<{ ok: boolean }>;
      const sent = results.filter((r) => r.ok).length;
      const failed = results.length - sent;
      setNotice(failed ? `${sent} withdrawn, ${failed} could not be sent yet. Try again in a minute.` : `Sent ${sent} payout${sent === 1 ? "" : "s"} to your wallet.`);
      onWithdraw?.({ sent, failed });
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Withdrawal failed.");
    } finally {
      setBusy(false);
    }
  }

  const card: CSSProperties = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: t.radius, padding: 20 };
  const text = (size: number, color = t.text, weight = 400): CSSProperties => ({ margin: 0, fontSize: size, color, fontWeight: weight, lineHeight: 1.4 });

  return (
    <div className={className} style={{ background: t.background, color: t.text, fontFamily: t.fontFamily, maxWidth: 480, boxSizing: "border-box" }}>
      {error && <p style={{ ...card, ...text(16, t.muted) }}>{error}</p>}
      {data && (
        <>
          <div style={card}>
            <p style={text(16, t.muted)}>Available to withdraw</p>
            <p style={{ ...text(36, t.text, 600), marginTop: 4 }}>{usd(available)}</p>
            {data.processing_usd > 0 && <p style={{ ...text(16, t.muted), marginTop: 8 }}>{usd(data.processing_usd)} still processing</p>}
            <label htmlFor="loofta-wallet" style={{ ...text(16, t.muted), display: "block", marginTop: 20 }}>
              USDC wallet address (Solana)
            </label>
            <input
              id="loofta-wallet"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="Paste your Solana wallet address"
              style={{ width: "100%", boxSizing: "border-box", marginTop: 8, padding: "12px 14px", fontSize: 16, color: t.text, background: "rgba(0,0,0,0.35)", border: `1px solid ${t.border}`, borderRadius: t.radius - 4, outline: "none", fontFamily: "inherit" }}
            />
            <button
              onClick={withdraw}
              disabled={busy || available <= 0 || !walletValid}
              style={{ width: "100%", marginTop: 16, padding: "12px 20px", fontSize: 16, fontWeight: 600, color: t.accentText, background: t.accent, border: 0, borderRadius: t.radius - 4, cursor: busy || available <= 0 || !walletValid ? "not-allowed" : "pointer", opacity: busy || available <= 0 || !walletValid ? 0.4 : 1, fontFamily: "inherit" }}
            >
              {busy ? "Sending..." : `Withdraw ${usd(available)}`}
            </button>
            {notice && <p style={{ ...text(16), marginTop: 12 }}>{notice}</p>}
          </div>

          <h3 style={{ ...text(18, t.text, 600), margin: "28px 0 12px" }}>History</h3>
          {data.history.length === 0 ? (
            <p style={text(16, t.muted)}>No payouts yet.</p>
          ) : (
            <ul style={{ ...card, listStyle: "none", margin: 0, padding: 0 }}>
              {data.history.map((h, i) => (
                <li key={h.payment_id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 16, borderTop: i ? `1px solid ${t.border}` : "none" }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={text(16, t.text, 500)}>{usd(h.amount)}</p>
                    <p style={{ ...text(16, t.muted), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.message || new Date(h.created_at).toLocaleDateString()}</p>
                  </div>
                  <span style={{ ...text(16, t.muted), flexShrink: 0 }}>{STATE_LABEL[h.state]}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
