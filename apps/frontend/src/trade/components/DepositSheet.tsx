"use client";

import { useEffect, useMemo, useState } from "react";
import { humanError } from "@/trade/lib/errors";
import { ArrowLeft, Check, ChevronRight, Copy, CreditCard, Loader2, Search } from "lucide-react";
import clsx from "clsx";
import { CardDeposit } from "@/trade/components/CardDeposit";
import { Sheet } from "@/trade/components/Sheet";
import { TelegramWalletDeposit } from "@/trade/components/TelegramWalletDeposit";
import { TokenIcon } from "@/trade/components/TokenIcon";
import { Segmented } from "@/trade/components/ui";
import { addressLooksValid, chainName, fetchNearTokens, findUsdcOnSolana, getNearQuote, getNearStatus, toAtomic, type NearQuote, type NearToken } from "@/trade/lib/near";
import { fmt } from "@/trade/lib/solana";
import { haptic } from "@/trade/lib/telegram";

type Mode = "telegram" | "other";
type View = { kind: "list" } | { kind: "card" } | { kind: "address" } | { kind: "token"; token: NearToken };

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-3">
      <div className="text-base text-mute">{label}</div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            haptic("success");
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            /* clipboard can be blocked in some webviews */
          }
        }}
        className="mt-1 flex w-full items-center justify-between gap-3 rounded-2xl bg-raised px-4 py-4 text-left active:scale-[0.98]"
      >
        <span className="break-all text-base">{value}</span>
        {done ? <Check size={20} className="shrink-0 text-up" /> : <Copy size={20} className="shrink-0 text-mute" />}
      </button>
    </div>
  );
}

function Back({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button type="button" onClick={onClick} className="mt-4 flex items-center gap-2 text-base font-semibold text-mute">
      <ArrowLeft size={18} />
      {title}
    </button>
  );
}

/** Pay with one coin on its own network. NEAR Intents gives a one-time address and delivers USDC to your wallet. */
function ChainDeposit({ token, tokens, address }: { token: NearToken; tokens: NearToken[]; address: string }) {
  const [amount, setAmount] = useState("");
  const [refund, setRefund] = useState("");
  const [quote, setQuote] = useState<NearQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("PENDING_DEPOSIT");
  const usdc = findUsdcOnSolana(tokens);
  const amountNum = Number(amount);
  const usd = token.price && amountNum > 0 ? amountNum * token.price : null;
  const ready = !!usdc && amountNum > 0 && addressLooksValid(token.chain, refund);

  const getAddress = async () => {
    if (!usdc) return;
    setBusy(true);
    setError(null);
    haptic("tap");
    try {
      setQuote(await getNearQuote({ originAsset: token.assetId, destinationAsset: usdc.assetId, amountAtomic: toAtomic(amount, token.decimals), recipient: address, refundTo: refund.trim() }));
    } catch (e) {
      setError(humanError(e, "Could not get a deposit address"));
    } finally {
      setBusy(false);
    }
  };

  // Follow the transfer once we have an address.
  useEffect(() => {
    if (!quote) return;
    let alive = true;
    const t = setInterval(() => getNearStatus(quote.depositAddress).then((s) => alive && setStatus(s)).catch(() => {}), 8_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [quote]);

  const finished = status === "SUCCESS";
  const failed = status === "FAILED" || status === "REFUNDED";

  if (quote) {
    return (
      <div>
        <div className={clsx("mt-4 rounded-2xl px-4 py-3 text-base font-semibold", finished ? "bg-up/15 text-up" : failed ? "bg-down/15 text-down" : "bg-raised")}>
          {finished ? "Done. Your money is in." : failed ? "This deposit did not complete and is being refunded." : "Waiting for your deposit"}
        </div>
        <p className="mt-3 text-base leading-snug text-mute">
          Send exactly {amount} {token.symbol} on {chainName(token.chain)} to the address below.{quote.amountOutFormatted ? ` You receive about $${fmt(Number(quote.amountOutFormatted), 2)} USDC.` : ""}
        </p>
        <CopyRow label={`Deposit address (${chainName(token.chain)})`} value={quote.depositAddress} />
        {quote.memo && <CopyRow label="Memo (required)" value={quote.memo} />}
        <p className="mt-3 text-base text-mute">Only send {token.symbol} on {chainName(token.chain)} here. Anything else can be lost.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mt-3 flex items-center gap-3">
        <TokenIcon symbol={token.symbol} size={44} />
        <div>
          <div className="font-display text-lg font-bold">{token.symbol}</div>
          <div className="text-base text-mute">on {chainName(token.chain)}. It arrives as USDC.</div>
        </div>
      </div>
      <div className="mt-3 flex h-14 items-center rounded-2xl bg-surface px-4">
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" className="h-full min-w-0 flex-1 bg-transparent font-display text-xl font-bold outline-none placeholder:text-mute/50" />
        <span className="pl-2 text-base font-semibold text-mute">{token.symbol}</span>
      </div>
      {usd != null && <div className="mt-1 text-base text-mute">About ${fmt(usd, 2)}</div>}
      <input value={refund} onChange={(e) => setRefund(e.target.value)} placeholder={`Your ${chainName(token.chain)} address, for refunds`} className="mt-3 h-14 w-full rounded-2xl bg-surface px-4 text-base outline-none placeholder:text-mute" />
      <p className="mt-1 text-base text-mute">If the deposit cannot complete, it goes back to this address.</p>
      {error && <div className="mt-3 text-base text-down">{error}</div>}
      <button type="button" disabled={!ready || busy} onClick={getAddress} className="btn3d mt-4 flex h-16 w-full items-center justify-center gap-2 text-lg">
        {busy && <Loader2 size={20} className="animate-spin" />}
        {busy ? "Getting address" : "Get deposit address"}
      </button>
    </div>
  );
}

/** One row in the list of ways to add money. */
function Row({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-[68px] w-full items-center gap-3 text-left">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-base font-bold">{title}</span>
        <span className="block truncate text-base text-mute">{sub}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-mute" />
    </button>
  );
}

/** Every other way to add money: card or Apple Pay, your Solana address, or any coin on its own network. Searchable. */
function OtherMethods({ tokens, address }: { tokens: NearToken[]; address: string }) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();

  const matches = (hay: string) => !s || hay.toLowerCase().includes(s);
  const showCard = matches("card apple pay google pay debit credit");
  const showAddress = matches("solana address usdc sol receive");
  const list = useMemo(
    () =>
      tokens
        .filter((t) => t.chain !== "sol" && (!s || t.symbol.toLowerCase().includes(s) || chainName(t.chain).toLowerCase().includes(s)))
        .sort((a, b) => Number(["USDC", "USDT", "ETH", "BTC", "SOL", "TON", "GRAM"].includes(b.symbol)) - Number(["USDC", "USDT", "ETH", "BTC", "SOL", "TON", "GRAM"].includes(a.symbol)))
        .slice(0, 80),
    [tokens, s],
  );

  if (view.kind === "card") {
    return (
      <>
        <Back onClick={() => setView({ kind: "list" })} title="Other ways to add" />
        <CardDeposit />
      </>
    );
  }
  if (view.kind === "address") {
    return (
      <>
        <Back onClick={() => setView({ kind: "list" })} title="Other ways to add" />
        <p className="mt-3 text-base leading-snug text-mute">Send SOL, USDC or any Solana coin to your address. It shows up here within seconds. Keep about $1 of SOL for network fees.</p>
        <CopyRow label="Your Solana address" value={address} />
      </>
    );
  }
  if (view.kind === "token") {
    return (
      <>
        <Back onClick={() => setView({ kind: "list" })} title="Other ways to add" />
        <ChainDeposit token={view.token} tokens={tokens} address={address} />
      </>
    );
  }

  return (
    <div>
      <div className="mt-4 flex h-14 items-center gap-3 rounded-2xl bg-surface px-4">
        <Search size={20} className="text-mute" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search card, coin or network" className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-mute" />
      </div>
      <div className="mt-1 max-h-[52vh] divide-y divide-white/5 overflow-y-auto">
        {showCard && (
          <Row
            icon={<span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#ff7a2a]/20 text-[#ff9a5a]"><CreditCard size={20} /></span>}
            title="Card or Apple Pay"
            sub="Apple Pay, Google Pay or card, by Meld"
            onClick={() => setView({ kind: "card" })}
          />
        )}
        {showAddress && <Row icon={<TokenIcon symbol="SOL" size={40} />} title="Solana address" sub="Send SOL, USDC or any Solana coin" onClick={() => setView({ kind: "address" })} />}
        {list.map((t) => (
          <Row key={t.assetId} icon={<TokenIcon symbol={t.symbol} size={40} />} title={t.symbol} sub={`on ${chainName(t.chain)}`} onClick={() => setView({ kind: "token", token: t })} />
        ))}
        {!showCard && !showAddress && list.length === 0 && <div className="py-8 text-center text-base text-mute">Nothing found</div>}
      </div>
    </div>
  );
}

/** Add money. Telegram Wallet first. Everything else is under Other: card or Apple Pay, your address, or any coin. */
export function DepositSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("telegram");
  const [tokens, setTokens] = useState<NearToken[]>([]);

  useEffect(() => {
    fetchNearTokens().then(setTokens).catch(() => {});
  }, []);

  return (
    <Sheet title="Add money" onClose={onClose}>
      <div className="mt-4">
        <Segmented<Mode>
          value={mode}
          onChange={(m) => {
            setMode(m);
            haptic("tap");
          }}
          options={[
            { id: "telegram", label: "Telegram Wallet" },
            { id: "other", label: "Other" },
          ]}
        />
      </div>
      {mode === "telegram" && <TelegramWalletDeposit address={address} tokens={tokens} />}
      {mode === "other" && <OtherMethods tokens={tokens} address={address} />}
    </Sheet>
  );
}
