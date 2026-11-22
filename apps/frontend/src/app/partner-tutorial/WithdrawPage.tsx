import { Mark } from "./Mark";

/**
 * The real Loofta withdraw page, reproduced from pay.loofta.com/withdraw (same colors, type, radii and copy), so the demo
 * shows exactly what a creator sees. Presentational only: the tour animates it by changing the props.
 */
const ROWS = [
  { id: "usdc", title: "USDC on Solana", hint: "To any Solana wallet", badge: "Fastest", icons: [["usdc.svg", "#2775CA"], ["logo/solana-mark.svg", "#111"]] },
  { id: "token", title: "Other tokens", hint: "BTC, ETH, ZEC, and other chains", icons: [["btc.svg", "#F7931A"], ["eth.svg", "#627EEA"]] },
  { id: "bank", title: "Bank or cards", hint: "Bank account, debit card or PAJ Cash", icons: [["icons/card-chip.svg", "#1C1C22"]] },
  { id: "p2p", title: "Private P2P", hint: "Wise, PayPal, Revolut, Venmo and more", icons: [["platforms/revolut.png", "#1C1C22"], ["platforms/venmo.png", "#008CFF"]] },
] as const;

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type WithdrawView = "list" | "usdc" | "sent";

export function WithdrawPage({
  brand, logo, amount = 400, fee, view = "list", enabled = ["usdc", "token", "bank", "p2p"], hot, wallet = "", walletFocus, email = "mira@example.com",
  history,
}: {
  brand: string; logo: string; amount?: number; fee: number; view?: WithdrawView; enabled?: string[]; hot?: string; wallet?: string; walletFocus?: boolean; email?: string;
  history?: Array<{ id: string; msg: string; date: string; amount: number }>;
}) {
  const rows = ROWS.filter((r) => enabled.includes(r.id));
  const crypto = rows.filter((r) => r.id === "usdc" || r.id === "token");
  const cash = rows.filter((r) => r.id === "bank" || r.id === "p2p");
  const both = crypto.length > 0 && cash.length > 0;
  const shown = crypto.length ? crypto : cash;
  const net = amount - fee;
  return (
    <div className="wdp">
      <div className="card">
        <div className="hd">
          <Mark id={logo} size={40} radius={12} />
          <p className="sora">{brand} payouts</p>
        </div>
        <div className="who">
          <div><small>Payouts for</small><b>{email}</b></div>
          <span>Not you? Sign out</span>
        </div>
        {view !== "sent" && (
          <div>
            <p className="amt sora">{usd(amount)}</p>
            <p className="avail">Available to withdraw</p>
          </div>
        )}
        {view === "list" && (
          <>
            {both && <div className="tabs"><span className="on">Crypto</span><span>Cash</span></div>}
            <p className="lab">SEND FUNDS TO</p>
            <div className="rows">
              {shown.map((r) => (
                <div key={r.id} className={`mrow ${hot === r.id ? "hot" : ""}`}>
                  <span className="ic">{r.icons.map(([src, bg]) => <span key={src} style={{ background: bg }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/images/${src}`} alt="" /></span>)}</span>
                  <span className="t"><b className="sora">{r.title}</b>{"badge" in r && <em>{r.badge}</em>}<small>{r.hint}</small></span>
                  <span className="arr">→</span>
                </div>
              ))}
            </div>
            {history && history.length > 0 && (
              <div className="hist">
                <p className="lab" style={{ margin: 0 }}>RECEIVED</p>
                <ul>{history.map((h) => <li key={h.id}><span><b>{h.msg}</b><small>Sent {h.date}</small></span><b>{usd(h.amount)}</b></li>)}</ul>
              </div>
            )}
          </>
        )}
        {view === "usdc" && (
          <>
            <p className="back">← USDC on Solana</p>
            <label className="flab">Solana wallet address</label>
            <div className={`inp ${walletFocus ? "f" : ""}`}>{wallet || <span style={{ color: "#86868b" }}>Paste any Solana wallet address</span>}</div>
            <p className="note">Only send to a wallet that supports USDC on Solana. Check the address, it cannot be undone.</p>
            <div className="sum"><div><span>Fees</span><span>{usd(fee)}</span></div><div><span>You receive</span><span>{usd(net)}</span></div></div>
            <div className="go">Withdraw {usd(net)}</div>
          </>
        )}
        {view === "sent" && (
          <>
            <p className="sent" style={{ marginTop: 20 }}>Sent 1 payout.</p>
            <p className="sent" style={{ color: "#3a3a3c" }}>There is nothing to withdraw for {email} yet. What you already received is listed below.</p>
            <div className="hist">
              <p className="lab" style={{ margin: 0 }}>RECEIVED</p>
              <ul><li><span><b>Summer Quest, 1st place</b><small>Sent {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</small></span><b>{usd(amount)}</b></li></ul>
            </div>
          </>
        )}
      </div>
      <div className="pow"><span>Powered by</span>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/loofta-white.svg" alt="Loofta" /></div>
    </div>
  );
}
