"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type HistoryItem = {
  payment_id: string;
  amount: number;
  message: string | null;
  created_at: string;
  state: "processing" | "available" | "withdrawn";
  withdrawn_to: string | null;
};

type PortalData = {
  partner: { name: string | null; logo_url: string | null };
  return_url: string | null;
  available_usd: number;
  processing_usd: number;
  history: HistoryItem[];
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATE_LABEL: Record<HistoryItem["state"], string> = {
  processing: "Processing",
  available: "Ready to withdraw",
  withdrawn: "Withdrawn",
};

/**
 * Hosted payout portal. A partner's server calls POST /payouts/portal-link and redirects the user
 * to /portal#token=<portal token> (the same token also powers the embeddable @loofta/portal
 * components, which render inside the partner's own page). The token lives in the URL fragment so it never reaches a
 * server log, and is only ever held in memory here. No Loofta account or login anywhere.
 */
export default function HostedPayoutsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    if (t) {
      setToken(t);
      // Drop it from the address bar/history so it can't be copied or shared by accident.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } else {
      setError("This payout page needs a valid link from the app that sent it.");
    }
  }, []);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`/api/backend/${path}`, {
        ...init,
        headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Something went wrong.");
      return body;
    },
    [token],
  );

  const load = useCallback(async () => {
    try {
      setData(await call("portal/me"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your payouts.");
    }
  }, [call]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const available = data?.available_usd ?? 0;
  const walletValid = useMemo(() => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet.trim()), [wallet]);

  async function withdraw() {
    setBusy(true);
    setNotice(null);
    try {
      const out = await call("portal/withdraw", { method: "POST", body: JSON.stringify({ destination_address: wallet.trim() }) });
      const ok = (out.results as Array<{ ok: boolean }>).filter((r) => r.ok).length;
      const bad = (out.results as Array<{ ok: boolean }>).length - ok;
      setNotice(bad ? `${ok} withdrawn, ${bad} could not be sent yet. Try again in a minute.` : `Sent ${ok} payout${ok === 1 ? "" : "s"} to your wallet.`);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Withdrawal failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0f0f12] text-slate-100 p-5">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-5 flex items-center gap-3">
          {data?.partner.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.partner.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
          )}
          <h1 className="text-xl font-semibold">{data?.partner.name ? `${data.partner.name} payouts` : "Your payouts"}</h1>
        </div>

        {data?.return_url && (
          <a href={data.return_url} className="mb-4 inline-block text-base text-slate-300 underline">
            Back to {data.partner.name ?? "app"}
          </a>
        )}

        {error && <p className="rounded-xl border border-white/15 bg-[#17171b] p-4 text-base text-slate-300">{error}</p>}

        {data && (
          <>
            <div className="rounded-2xl border border-white/15 bg-[#17171b] p-5">
              <p className="text-base text-slate-400">Available to withdraw</p>
              <p className="mt-1 text-4xl font-semibold">{usd(available)}</p>
              {data.processing_usd > 0 && <p className="mt-2 text-base text-slate-400">{usd(data.processing_usd)} still processing</p>}

              <label className="mt-5 block text-base text-slate-300" htmlFor="wallet">
                USDC wallet address (Solana)
              </label>
              <input
                id="wallet"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="Paste your Solana wallet address"
                className="mt-2 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-base text-slate-100 outline-none focus:border-white/40"
              />
              <button
                onClick={withdraw}
                disabled={busy || available <= 0 || !walletValid}
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] px-6 py-3 text-base text-white font-semibold hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Sending..." : `Withdraw ${usd(available)}`}
              </button>
              <p className="mt-3 text-base text-slate-400">Withdrawals to a wallet are free. Cash-out options are coming soon.</p>
              {notice && <p className="mt-3 text-base text-slate-200">{notice}</p>}
            </div>

            <h2 className="mt-7 mb-3 text-lg font-semibold">History</h2>
            {data.history.length === 0 ? (
              <p className="text-base text-slate-400">No payouts yet.</p>
            ) : (
              <ul className="divide-y divide-white/10 rounded-2xl border border-white/15 bg-[#17171b]">
                {data.history.map((h) => (
                  <li key={h.payment_id} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-base font-medium">{usd(h.amount)}</p>
                      <p className="truncate text-base text-slate-400">{h.message || new Date(h.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className="shrink-0 text-base text-slate-300">{STATE_LABEL[h.state]}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
