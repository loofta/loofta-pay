"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Figtree, Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import "./billing-demo.css";
import {
  BILLED, EVERY, FEE_PERCENT, MAIL_SUBJECT, SEED_PLANS, SEED_SUBSCRIBERS, START_DATE,
  addDays, addInterval, fmtDate, money, monthlyValue, slugId,
  type Charge, type Interval, type Mail, type MailKind, type Plan, type SubscriberRow, type Subscription,
} from "./mockBilling";

const body = Figtree({ subsets: ["latin"], variable: "--font-bd-body", display: "swap" });
const display = Schibsted_Grotesk({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-bd-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-bd-mono", display: "swap" });

type Tab = "setup" | "site" | "checkout" | "emails" | "manage" | "dash";
type Share = "link" | "script" | "api";

const STEPS: { id: Tab; title: string; who: string }[] = [
  { id: "setup", title: "Create a plan", who: "Business" },
  { id: "site", title: "Add the button", who: "Business" },
  { id: "checkout", title: "Customer pays", who: "Customer" },
  { id: "emails", title: "Emails", who: "Automatic" },
  { id: "manage", title: "Manage and renew", who: "Customer" },
  { id: "dash", title: "Business dashboard", who: "Business" },
];

interface State {
  tab: Tab;
  today: Date;
  plans: Plan[];
  form: { name: string; price: string; interval: Interval };
  sel: string;
  share: Share;
  step: number;
  email: string;
  balance: number;
  fundAmt: number;
  agreed: boolean;
  sub: Subscription | null;
  charges: Charge[];
  emails: Mail[];
  openMail: number;
  confirmCancel: boolean;
}

const INITIAL: State = {
  tab: "setup", today: START_DATE, plans: SEED_PLANS, form: { name: "", price: "", interval: "month" },
  sel: "core-m", share: "link", step: 0, email: "sam@northpeak.io", balance: 0, fundAmt: 798, agreed: false,
  sub: null, charges: [], emails: [], openMail: 0, confirmCancel: false,
};

export default function BillingDemo() {
  const [s, setS] = useState<State>(INITIAL);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const set = (p: Partial<State>) => setS((prev) => ({ ...prev, ...p }));
  const say = (msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2400);
  };
  const plan = s.plans.find((p) => p.id === s.sel) ?? s.plans[0];

  const mail = (kind: MailKind, p: Plan, date: Date, extra: Partial<Mail> = {}): Mail => ({
    kind, plan: p, date, email: s.email, subject: MAIL_SUBJECT(kind, p), ...extra,
  });

  /** One charge attempt. Returns the next state pieces, mirroring what the future charge job will do. */
  function runCharge(sub: Subscription, balance: number, today: Date) {
    const p = sub.plan;
    if (balance >= p.price) {
      return { ok: true, balance: balance - p.price, sub: { ...sub, next: addInterval(sub.next, p.interval), status: "active" as const }, charge: { date: today, amount: p.price, ok: true } };
    }
    return { ok: false, balance, sub: { ...sub, status: "past_due" as const }, charge: { date: today, amount: p.price, ok: false } };
  }

  function approve() {
    const first: Subscription = { plan, next: addInterval(s.today, plan.interval), status: "active" };
    const balance = s.balance - plan.price;
    const mails: Mail[] = [mail("welcome", plan, s.today, { next: first.next })];
    if (balance < plan.price) mails.unshift(mail("low", plan, s.today, { next: first.next, balance }));
    set({ sub: first, balance, charges: [{ date: s.today, amount: plan.price, ok: true }, ...s.charges], emails: [...mails, ...s.emails], openMail: 0, step: 3 });
  }

  function jump() {
    if (!s.sub || s.sub.status === "cancelled") return;
    const due = s.sub.next;
    const p = s.sub.plan;
    const mails: Mail[] = [mail("reminder", p, addDays(due, -3), { next: due, balance: s.balance })];
    const r = runCharge(s.sub, s.balance, due);
    if (r.ok) {
      mails.unshift(mail("receipt", p, due, { next: r.sub.next, balance: r.balance }));
      if (r.balance < p.price) mails.unshift(mail("low", p, due, { next: r.sub.next, balance: r.balance }));
      say(`Charged ${money(p.price)}, next payment ${fmtDate(r.sub.next)}`);
    } else {
      mails.unshift(mail("failed", p, due, { balance: r.balance }));
      say("Payment failed, customer emailed");
    }
    set({ today: due, sub: r.sub, balance: r.balance, charges: [r.charge, ...s.charges], emails: [...mails, ...s.emails], openMail: 0 });
  }

  function topUp(amt: number) {
    const balance = s.balance + amt;
    if (s.sub && s.sub.status === "past_due" && balance >= s.sub.plan.price) {
      const r = runCharge(s.sub, balance, s.today);
      set({ balance: r.balance, sub: r.sub, charges: [r.charge, ...s.charges], emails: [mail("receipt", s.sub.plan, s.today, { next: r.sub.next, balance: r.balance }), ...s.emails], openMail: 0 });
      say("Retry succeeded, subscription active again");
      return;
    }
    set({ balance });
    say(`${money(amt)} added`);
  }

  function cancel() {
    if (!s.sub) return;
    set({ sub: { ...s.sub, status: "cancelled" }, confirmCancel: false, emails: [mail("cancelled", s.sub.plan, s.today), ...s.emails], openMail: 0 });
    say("Subscription cancelled");
  }

  function createPlan(e: React.FormEvent) {
    e.preventDefault();
    const price = parseFloat(s.form.price);
    if (!s.form.name.trim() || !(price > 0)) { say("Add a name and a price"); return; }
    const p: Plan = { id: slugId(s.form.name, s.form.interval), name: s.form.name.trim(), price, interval: s.form.interval };
    set({ plans: [...s.plans, p], sel: p.id, form: { name: "", price: "", interval: "month" }, tab: "site" });
    say("Plan created, link is ready");
  }

  function reset() { setS(INITIAL); }

  const urls: Record<Tab, string> = {
    setup: "business.loofta.com/plans",
    site: "business.loofta.com/plans/integrate",
    checkout: `checkout.loofta.com/p/grapevine-${plan.id}`,
    emails: `Inbox: ${s.email}`,
    manage: "checkout.loofta.com/manage",
    dash: "business.loofta.com/dashboard",
  };
  const customerSide = s.tab === "checkout" || s.tab === "manage" || s.tab === "emails";
  const side = s.tab === "emails" ? "Customer inbox" : customerSide ? "Customer" : "Business";

  return (
    <div className={`bd ${body.variable} ${display.variable} ${mono.variable}`}>
      <div className="wrap">
        <div className="bar">
          <div>
            <h1>Loofta Billing</h1>
            <p className="sub">Recurring USDC subscriptions for businesses. Demo with sample data, nothing here is real money.</p>
          </div>
          <p className="sub">Demo date: {fmtDate(s.today)}</p>
        </div>

        <div className="steps" role="tablist">
          {STEPS.map((st, i) => (
            <button key={st.id} className="step" role="tab" aria-selected={s.tab === st.id} onClick={() => set({ tab: st.id })}>
              <span className="n">Step {i + 1}</span>
              <span className="t">{st.title}</span>
              <span className="w">{st.who}</span>
            </button>
          ))}
        </div>

        <div className="frame">
          <div className="chrome">
            <div className="url">{urls[s.tab]}</div>
            <span className={`tag${customerSide ? " cust" : ""}`}>{side}</span>
          </div>
          <div className="stage">
            {s.tab === "setup" && <Setup s={s} set={set} createPlan={createPlan} />}
            {s.tab === "site" && <Site s={s} set={set} plan={plan} say={say} />}
            {s.tab === "checkout" && <Checkout s={s} set={set} plan={plan} approve={approve} say={say} reset={reset} />}
            {s.tab === "emails" && <Emails s={s} set={set} />}
            {s.tab === "manage" && <Manage s={s} set={set} topUp={topUp} jump={jump} cancel={cancel} />}
            {s.tab === "dash" && <Dashboard s={s} />}
          </div>
        </div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

type SetFn = (p: Partial<State>) => void;

function KV({ k, v }: { k: string; v: ReactNode }) {
  return <div className="kv"><span>{k}</span><span>{v}</span></div>;
}
function Empty({ children, onGo }: { children: string; onGo: () => void }) {
  return (
    <div className="empty">
      <p>{children}</p>
      <button className="btn" onClick={onGo}>Go to checkout</button>
    </div>
  );
}

/* ---------- business: plans ---------- */
function Setup({ s, set, createPlan }: { s: State; set: SetFn; createPlan: (e: React.FormEvent) => void }) {
  return (
    <div className="grid2">
      <div className="panel">
        <div>
          <h3>Plans</h3>
          <p className="muted">Grapevine sells Core and Pro. Prices are in USDC.</p>
        </div>
        <div className="scroll">
          <table>
            <thead><tr><th>Plan</th><th>Price</th><th>Billed</th><th /></tr></thead>
            <tbody>
              {s.plans.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b></td>
                  <td className="num">{money(p.price)}</td>
                  <td>{BILLED[p.interval]}</td>
                  <td className="r"><button className="btn ghost sm" onClick={() => set({ sel: p.id, tab: "site" })}>Get link</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <form className="panel" onSubmit={createPlan}>
        <h3>New plan</h3>
        <div className="field">
          <label htmlFor="bd-pn">Plan name</label>
          <input id="bd-pn" type="text" placeholder="Tailored" value={s.form.name} onChange={(e) => set({ form: { ...s.form, name: e.target.value } })} />
        </div>
        <div className="field">
          <label htmlFor="bd-pp">Price in USDC</label>
          <input id="bd-pp" type="number" min={1} placeholder="2500" value={s.form.price} onChange={(e) => set({ form: { ...s.form, price: e.target.value } })} />
        </div>
        <div className="field">
          <label htmlFor="bd-pi">Billed</label>
          <select id="bd-pi" value={s.form.interval} onChange={(e) => set({ form: { ...s.form, interval: e.target.value as Interval } })}>
            <option value="month">Monthly</option>
            <option value="quarter">Every 3 months</option>
            <option value="year">Yearly</option>
          </select>
        </div>
        <button className="btn" type="submit">Create plan</button>
      </form>
    </div>
  );
}

/* ---------- business: integrate ---------- */
function Site({ s, set, plan, say }: { s: State; set: SetFn; plan: Plan; say: (m: string) => void }) {
  const link = `https://checkout.loofta.com/p/grapevine-${plan.id}`;
  const snippets: Record<Share, string> = {
    link: `<a href="${link}">Subscribe to ${plan.name}</a>`,
    script: `<script src="https://checkout.loofta.com/loofta.js"></script>\n<button data-loofta-plan="grapevine-${plan.id}"\n        data-loofta-email="{{customer.email}}">\n  Subscribe to ${plan.name}\n</button>`,
    api: `curl https://api.loofta.com/v1/checkout-sessions \\\n  -H "Authorization: Bearer lf_live_..." \\\n  -d plan="grapevine-${plan.id}" \\\n  -d customer_email="sam@northpeak.io" \\\n  -d success_url="https://grapevine.run/welcome"\n\n# returns { "url": "https://checkout.loofta.com/s/9fK2..." }`,
  };
  const copy = () => {
    const done = () => say("Snippet copied");
    try { navigator.clipboard.writeText(snippets[s.share]).then(done, done); } catch { done(); }
  };
  const tabs: [Share, string][] = [["link", "Payment link"], ["script", "Button snippet"], ["api", "API"]];
  return (
    <div className="grid2">
      <div className="panel">
        <div>
          <h3>Put it on your site</h3>
          <p className="muted">Pick how you want to send people to pay. All three open the same Loofta checkout.</p>
        </div>
        <div className="field">
          <label htmlFor="bd-plansel">Plan</label>
          <select id="bd-plansel" value={s.sel} onChange={(e) => set({ sel: e.target.value })}>
            {s.plans.map((p) => <option key={p.id} value={p.id}>{p.name} {money(p.price)} {EVERY[p.interval]}</option>)}
          </select>
        </div>
        <div className="tabs" role="group" aria-label="Integration">
          {tabs.map(([id, label]) => <button key={id} aria-pressed={s.share === id} onClick={() => set({ share: id })}>{label}</button>)}
        </div>
        <pre className="code">{snippets[s.share]}</pre>
        <div className="row">
          <button className="btn" onClick={copy}>Copy</button>
          <button className="btn ghost" onClick={() => set({ tab: "checkout" })}>Try it as a customer</button>
        </div>
      </div>
      <div className="panel">
        <h3>What your customer sees</h3>
        <div className="site">
          <span className="muted">grapevine.run/pricing</span>
          <span className="pr">{plan.name}</span>
          <span className="num"><b>{money(plan.price)}</b> USDC {EVERY[plan.interval]}</span>
          <span className="btn brand">Subscribe to {plan.name}</span>
        </div>
        <p className="muted">The button opens a Loofta page with your logo and colours. You never handle wallets, approvals or reminders.</p>
      </div>
    </div>
  );
}

/* ---------- customer: checkout ---------- */
function Merchant({ sub }: { sub: string }) {
  return (
    <div className="merchant">
      <div className="mono-logo">G</div>
      <div><b>{sub === "checkout" ? "Grapevine" : "Your subscriptions"}</b><div className="muted">{sub === "checkout" ? "Secure checkout by Loofta" : ""}</div></div>
    </div>
  );
}
function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className="plancard">
      <b>{plan.name}</b>
      <span className="price num">{money(plan.price)}</span>
      <span className="muted">USDC {EVERY[plan.interval]}. Cancel any time.</span>
    </div>
  );
}
function Checkout({ s, set, plan, approve, say, reset }: { s: State; set: SetFn; plan: Plan; approve: () => void; say: (m: string) => void; reset: () => void }) {
  const st = s.step;
  const fund = () => { set({ balance: s.balance + s.fundAmt }); say(`${money(s.fundAmt)} added to your Loofta balance`); };
  const first = addInterval(s.today, plan.interval);
  return (
    <div className="co">
      <Merchant sub="checkout" />
      <div className="prog">{[0, 1, 2, 3].map((i) => <span key={i} className={i <= st ? "on" : ""} />)}</div>

      {st === 0 && (
        <>
          <PlanCard plan={plan} />
          <div className="field">
            <label htmlFor="bd-em">Your email</label>
            <input id="bd-em" type="email" autoComplete="email" value={s.email} onChange={(e) => set({ email: e.target.value })} />
          </div>
          <button className="btn brand" onClick={() => set({ step: 1 })}>Continue</button>
          <p className="foot">We create a secure Loofta wallet for you from this email. No app or browser extension.</p>
        </>
      )}

      {st === 1 && (
        <>
          <PlanCard plan={plan} />
          <div>
            <h3>Add funds</h3>
            <p className="muted">Your balance pays Grapevine automatically. Adding one extra payment means you never miss a renewal.</p>
          </div>
          <KV k="Loofta balance" v={<span className="num">{money(s.balance)}</span>} />
          <div className="chips" role="group" aria-label="Amount">
            {[plan.price, plan.price * 2, plan.price * 3].map((a) => (
              <button key={a} className="chip num" aria-pressed={s.fundAmt === a} onClick={() => set({ fundAmt: a })}>{money(a)}</button>
            ))}
          </div>
          <div className="row">
            <button className="btn brand" onClick={fund}>Deposit {money(s.fundAmt)} USDC</button>
            <button className="btn ghost" onClick={fund}>Pay by card</button>
          </div>
          <button className="btn brand" disabled={s.balance < plan.price} onClick={() => set({ step: 2 })}>Continue</button>
          {s.balance < plan.price && <p className="foot">Add at least {money(plan.price)} to continue.</p>}
        </>
      )}

      {st === 2 && (
        <>
          <div>
            <h3>Approve recurring payments</h3>
            <p className="muted">Review exactly what you are allowing.</p>
          </div>
          <PlanCard plan={plan} />
          <div>
            <KV k="Pay today" v={money(plan.price)} />
            <KV k="Then" v={`${money(plan.price)} ${EVERY[plan.interval]}`} />
            <KV k="Next payment" v={fmtDate(first)} />
            <KV k="Paid to" v="Grapevine only" />
            <KV k="Balance after today" v={money(s.balance - plan.price)} />
          </div>
          <label className="consent" htmlFor="bd-agree">
            <input id="bd-agree" type="checkbox" checked={s.agreed} onChange={(e) => set({ agreed: e.target.checked })} />
            <span>I allow Loofta to charge <b>{money(plan.price)}</b> {EVERY[plan.interval]} from my balance to Grapevine, and nothing more. I can cancel any time.</span>
          </label>
          <button className="btn brand" disabled={!s.agreed} onClick={approve}>Approve and pay {money(plan.price)}</button>
          <p className="foot">Loofta cannot send more than this amount, or send to anyone else. This limit is enforced by your wallet policy.</p>
        </>
      )}

      {st === 3 && s.sub && (
        <>
          <div className="big-ok" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
          </div>
          <div>
            <h3>You are subscribed</h3>
            <p className="muted">A receipt is on its way to {s.email}.</p>
          </div>
          <div>
            <KV k="Plan" v={s.sub.plan.name} />
            <KV k="Paid today" v={money(s.sub.plan.price)} />
            <KV k="Next payment" v={fmtDate(s.sub.next)} />
            <KV k="Balance" v={money(s.balance)} />
          </div>
          <div className="row">
            <button className="btn brand" onClick={() => set({ tab: "manage" })}>Manage subscription</button>
            <button className="btn ghost" onClick={() => set({ tab: "emails" })}>See the emails</button>
          </div>
          <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={reset}>Restart demo</button>
        </>
      )}
    </div>
  );
}

/* ---------- customer: manage ---------- */
function Manage({ s, set, topUp, jump, cancel }: { s: State; set: SetFn; topUp: (n: number) => void; jump: () => void; cancel: () => void }) {
  const sub = s.sub;
  if (!sub) return <Empty onGo={() => set({ tab: "checkout" })}>No subscription yet. Complete the customer checkout first.</Empty>;
  const p = sub.plan;
  const covers = Math.floor(s.balance / p.price);
  const label = { active: "Active", past_due: "Payment failed", cancelled: "Cancelled" }[sub.status];
  const gone = sub.status === "cancelled";
  return (
    <div className="co wide">
      <div className="merchant">
        <div className="mono-logo">G</div>
        <div><b>Your subscriptions</b><div className="muted">{s.email}</div></div>
      </div>

      {sub.status === "past_due" && <div className="notice bad">Your last payment failed. Add {money(p.price - s.balance)} or more and we retry instantly.</div>}
      {sub.status === "active" && covers < 1 && <div className="notice warn">Your balance will not cover the next payment on {fmtDate(sub.next)}.</div>}

      {gone ? (
        <div className="empty"><p>Subscription cancelled. No more payments will be taken.</p></div>
      ) : (
        <>
          <div className="panel">
            <div className="row between">
              <div>
                <b style={{ fontFamily: "var(--display)", fontSize: 20 }}>Grapevine {p.name}</b>
                <div className="muted num">{money(p.price)} {EVERY[p.interval]}</div>
              </div>
              <span className={`pill ${sub.status}`}>{label}</span>
            </div>
            <KV k="Next payment" v={fmtDate(sub.next)} />
            <KV k="Loofta balance" v={<span className="num">{money(s.balance)}</span>} />
            <KV k="Payments covered" v={`${covers} ${covers === 1 ? "payment" : "payments"}`} />
          </div>
          <div className="panel">
            <h3>Top up</h3>
            <div className="row">
              <button className="btn brand sm" onClick={() => topUp(p.price)}>Add {money(p.price)}</button>
              <button className="btn ghost sm" onClick={() => topUp(p.price * 2)}>Add {money(p.price * 2)}</button>
            </div>
          </div>
        </>
      )}

      {s.charges.length > 0 && (
        <div className="panel">
          <h3>History</h3>
          <div className="scroll">
            <table>
              <thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {s.charges.map((c, i) => (
                  <tr key={i}>
                    <td>{fmtDate(c.date)}</td>
                    <td className="num">{money(c.amount)}</td>
                    <td><span className={`pill ${c.ok ? "active" : "past_due"}`}>{c.ok ? "Paid" : "Failed"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!gone && (s.confirmCancel ? (
        <div className="panel">
          <p>Cancel Grapevine {p.name}? Payments stop immediately.</p>
          <div className="row">
            <button className="btn danger sm" onClick={cancel}>Yes, cancel</button>
            <button className="btn ghost sm" onClick={() => set({ confirmCancel: false })}>Keep it</button>
          </div>
        </div>
      ) : (
        <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => set({ confirmCancel: true })}>Cancel subscription</button>
      ))}

      <div className="demo">
        <b>Demo controls</b>
        <div className="row">
          <button className="btn sm" disabled={gone} onClick={jump}>Jump to next payment date</button>
          <button className="btn ghost sm" disabled={gone} onClick={() => set({ balance: Math.min(s.balance, 40) })}>Customer spends their balance</button>
        </div>
        <p className="muted">Today in the demo: {fmtDate(s.today)}</p>
      </div>
    </div>
  );
}

/* ---------- emails ---------- */
function MailView({ m, sub }: { m: Mail; sub: Subscription | null }) {
  const p = m.plan;
  const cta = (t: string) => <span className="btn brand" style={{ alignSelf: "flex-start" }}>{t}</span>;
  let content: ReactNode = null;
  if (m.kind === "welcome") content = <><h2>You are subscribed to {p.name}</h2><p>Your first payment of <b>{money(p.price)} USDC</b> went through today. Your next payment is on <b>{fmtDate(m.next ?? sub?.next ?? m.date)}</b>.</p>{cta("View your subscription")}</>;
  if (m.kind === "reminder") content = <><h2>Payment coming up on {fmtDate(m.next ?? m.date)}</h2><p><b>{money(p.price)}</b> will be taken from your Loofta balance for {p.name}. Your balance is <b>{money(m.balance ?? 0)}</b>.</p>{cta("Top up balance")}</>;
  if (m.kind === "receipt") content = <><h2>Payment received</h2><p>{money(p.price)} for {p.name} on {fmtDate(m.date)}. Next payment: <b>{fmtDate(m.next ?? m.date)}</b>.</p><div className="box"><KV k="Plan" v={p.name} /><KV k="Amount" v={money(p.price)} /><KV k="Balance left" v={money(m.balance ?? 0)} /></div>{cta("View receipt")}</>;
  if (m.kind === "low") content = <><h2>Your balance will not cover the next payment</h2><p>You have <b>{money(m.balance ?? 0)}</b> left and your next payment of <b>{money(p.price)}</b> is on <b>{fmtDate(m.next ?? m.date)}</b>. Add funds to avoid an interruption.</p>{cta("Add funds")}</>;
  if (m.kind === "failed") content = <><h2>We could not take {money(p.price)}</h2><p>Your balance was <b>{money(m.balance ?? 0)}</b>. Add funds and we will retry straight away. We also try again in 1, 3 and 5 days.</p>{cta("Add funds now")}</>;
  if (m.kind === "cancelled") content = <><h2>Subscription cancelled</h2><p>No more payments will be taken. Any money left in your Loofta balance is still yours to withdraw.</p></>;
  return (
    <div className="mail">
      <div className="hd"><span><b>To:</b> {m.email}</span><span><b>Subject:</b> {m.subject}</span></div>
      <div className="bd-body">
        <div className="merchant"><div className="mono-logo">G</div><b>Grapevine</b></div>
        {content}
        <p className="muted">Sent by Loofta on behalf of Grapevine. Manage or cancel any time at checkout.loofta.com/manage</p>
      </div>
    </div>
  );
}
function Emails({ s, set }: { s: State; set: SetFn }) {
  if (!s.emails.length) return <Empty onGo={() => set({ tab: "checkout" })}>No emails yet. Complete the customer checkout and they appear here.</Empty>;
  return (
    <div className="mails">
      <div className="mlist">
        {s.emails.map((m, i) => (
          <button key={i} className="mitem" aria-pressed={i === s.openMail} onClick={() => set({ openMail: i })}>
            <span className="s">{m.subject}</span>
            <span className="m">{fmtDate(m.date)}</span>
          </button>
        ))}
      </div>
      <MailView m={s.emails[s.openMail] ?? s.emails[0]} sub={s.sub} />
    </div>
  );
}

/* ---------- business: dashboard ---------- */
function Dashboard({ s }: { s: State }) {
  const rows: SubscriberRow[] = [...SEED_SUBSCRIBERS];
  if (s.sub) {
    const covers = Math.floor(s.balance / s.sub.plan.price);
    rows.unshift({
      who: s.email, plan: s.sub.plan.name, price: s.sub.plan.price, interval: s.sub.plan.interval, next: s.sub.next, status: s.sub.status,
      prepaid: s.sub.status === "cancelled" ? "None" : covers ? `Covers ${covers} ${covers === 1 ? "payment" : "payments"}` : `Needs ${money(s.sub.plan.price - s.balance)}`,
      fresh: true,
    });
  }
  const active = rows.filter((r) => r.status === "active");
  const mrr = active.reduce((t, r) => t + monthlyValue(r.price, r.interval), 0);
  const week = addDays(s.today, 7);
  const due = active.filter((r) => r.next <= week).reduce((t, r) => t + r.price, 0);
  const failed = rows.filter((r) => r.status === "past_due").length;
  const paid = s.charges.filter((c) => c.ok);
  const label = { active: "Active", past_due: "Payment failed", cancelled: "Cancelled" };
  return (
    <div className="col">
      <div className="kpis">
        <div className="kpi"><span className="v num">{money(mrr)}</span><span className="l">Monthly recurring revenue</span></div>
        <div className="kpi"><span className="v num">{active.length}</span><span className="l">Active subscribers</span></div>
        <div className="kpi"><span className="v num">{money(due)}</span><span className="l">Due in the next 7 days</span></div>
        <div className="kpi"><span className="v num">{failed}</span><span className="l">Failed payments</span></div>
      </div>
      <div className="panel">
        <h3>Subscribers</h3>
        <div className="scroll">
          <table>
            <thead><tr><th>Customer</th><th>Plan</th><th>Price</th><th>Next payment</th><th>Prepaid</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.fresh ? "hl" : undefined}>
                  <td><b>{r.who}</b> {r.fresh && <span className="pill new">New</span>}</td>
                  <td>{r.plan}</td>
                  <td className="num">{money(r.price)}</td>
                  <td>{fmtDate(r.next)}</td>
                  <td>{r.prepaid}</td>
                  <td><span className={`pill ${r.status}`}>{label[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <div className="row between">
          <h3>Payments received</h3>
          <span className="muted">Paid straight to your business wallet. Fee {FEE_PERCENT}% (pilot rate).</span>
        </div>
        <div className="scroll">
          <table>
            <thead><tr><th>Date</th><th>Customer</th><th>Charged</th><th>Loofta fee</th><th>You received</th></tr></thead>
            <tbody>
              {paid.length === 0 ? (
                <tr><td colSpan={5} className="muted">Charges from your new subscriber appear here. Run the customer checkout.</td></tr>
              ) : paid.map((c, i) => {
                const fee = (c.amount * FEE_PERCENT) / 100;
                return (
                  <tr key={i}>
                    <td>{fmtDate(c.date)}</td><td>{s.email}</td>
                    <td className="num">{money(c.amount)}</td><td className="num">{money(fee)}</td><td className="num"><b>{money(c.amount - fee)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
