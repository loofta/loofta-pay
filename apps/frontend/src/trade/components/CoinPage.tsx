"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { humanError } from "@/trade/lib/errors";
import clsx from "clsx";
import { ArrowLeft, Check, Copy, ExternalLink, Globe, Loader2, Send, ShieldCheck } from "lucide-react";
import { PUMP_UNSUPPORTED, buildPump, buildSwap, quotePump, quoteSwap, submitSwap, type SwapQuote } from "@/trade/lib/api";
import { USDC, WSOL, b64ToBytes, baseToHuman, bytesToB64, fmt } from "@/trade/lib/solana";
import { getSolUsd } from "@/trade/lib/holdings";
import { getConnection, getSolBalance, getTokenBalance, waitForConfirmation } from "@/trade/lib/balances";
import { haptic, openExternal } from "@/trade/lib/telegram";
import { CHECK_DOT, RISK_STYLE, STAGE_STYLE, fetchMemecoinDetail, fillText, formatAge, formatAgeAt, formatChange, formatUsd, type MemecoinDetail, type MemecoinItem } from "@/trade/lib/memecoin";
import type { CoinRef } from "@/trade/lib/coin";
import { assetAbout } from "@/trade/lib/assetAbout";
import { reportTrade } from "@/trade/lib/rewards";
import { useWallet } from "@/trade/hooks/useWallet";
import { Avatar, ConfettiBurst, Pill, Segmented, Tile } from "@/trade/components/ui";
import { LiveChart } from "@/trade/components/LiveChart";
import { Sheet } from "@/trade/components/Sheet";
import { ChatPanel, HoldersList, TradesList } from "@/trade/components/CoinTabs";
import { useLiveTrades } from "@/trade/hooks/useLiveTrades";

type CoinInfoData = {
  found: boolean;
  marketCap: number | null;
  fdv: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  change24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  athUsd: number | null;
  athChangePct: number | null;
  rank: number | null;
  createdAt: number | null;
  description: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
};

const INFO_CACHE = new Map<string, { at: number; data: CoinInfoData }>();

/** Details for a coin outside the meme feed. Kept 10 minutes in the app so reopening a coin does not ask again. */
async function getCoinInfo(mint: string): Promise<CoinInfoData | null> {
  const hit = INFO_CACHE.get(mint);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  try {
    const data = (await fetch(`/api/backend/mini/info?mint=${mint}`).then((r) => r.json())) as CoinInfoData;
    INFO_CACHE.set(mint, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

type HolderMeta = { count: number | null; top10Pct: number | null };
const HOLDER_CACHE = new Map<string, { at: number; data: HolderMeta }>();
/** Share of the supply the ten biggest holders have. Anything over 100% is not a real number, so it is dropped and nothing is shown. */
function top10Of(j: { top10Pct?: number | null; holders?: Array<{ pct: number }> }): number | null {
  const v = j.top10Pct ?? (j.holders?.length ? j.holders.slice(0, 10).reduce((a, h) => a + h.pct, 0) : null);
  return v != null && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}
/** Holder count and the top 10 share, read from Solana by the backend. */
async function getHolderMeta(mint: string): Promise<HolderMeta | null> {
  const hit = HOLDER_CACHE.get(mint);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  try {
    const j = (await fetch(`/api/backend/mini/holders?mint=${mint}`).then((r) => r.json())) as { count?: number | null; top10Pct?: number | null; holders?: Array<{ pct: number }> };
    const top10 = top10Of(j);
    const data = { count: j.count ?? null, top10Pct: top10 };
    if (data.count != null || data.top10Pct != null) HOLDER_CACHE.set(mint, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

/**
 * The strip under the price: the coin address to copy (the first thing people want), links to its X, Telegram and website,
 * and the facts people check before buying: how old it is, how many holders, and how much the ten biggest hold.
 */
function CoinMeta({ mint, item, now }: { mint: string; item: MemecoinDetail | MemecoinItem | null; now: number }) {
  const [copied, setCopied] = useState(false);
  const [info, setInfo] = useState<CoinInfoData | null>(null);
  const [hm, setHm] = useState<HolderMeta | null>(() => HOLDER_CACHE.get(mint)?.data ?? null);
  const hasItem = !!item;
  useEffect(() => {
    let alive = true;
    getHolderMeta(mint).then((d) => alive && d && setHm(d));
    // Coins from the meme feed carry their own links. Others get them from the details lookup.
    if (!hasItem) getCoinInfo(mint).then((d) => alive && setInfo(d));
    return () => {
      alive = false;
    };
  }, [mint, hasItem]);

  const twitter = item?.twitter ?? info?.twitter ?? null;
  const telegram = item?.telegram ?? info?.telegram ?? null;
  const website = item?.website ?? info?.website ?? null;
  const holders = item?.holders ?? hm?.count ?? null;
  const age = item ? formatAgeAt(item.createdAt, now) ?? formatAge(item.ageMinutes) : null;
  const facts = [age ? `${age} old` : null, holders != null ? `${holders.toLocaleString("en-US")} holders` : null, hm?.top10Pct != null ? `Top 10 hold ${hm.top10Pct.toFixed(hm.top10Pct >= 10 ? 0 : 1)}%` : null].filter(Boolean) as string[];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      haptic("success");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can be blocked in some webviews */
    }
  };
  const icon = "btn3d dark grid h-11 w-11 shrink-0 place-items-center !rounded-2xl";
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={copy} aria-label="Copy address" className="flex h-11 min-w-0 items-center gap-2 rounded-2xl bg-surface px-3.5 font-mono text-base text-ink active:scale-[0.98]">
          <span className="truncate">
            {mint.slice(0, 4)}...{mint.slice(-4)}
          </span>
          {copied ? <Check size={18} className="shrink-0 text-up" /> : <Copy size={18} className="shrink-0 text-mute" />}
        </button>
        {twitter && (
          <button type="button" aria-label="X" onClick={() => openExternal(twitter)} className={`${icon} font-display text-lg font-extrabold`}>
            X
          </button>
        )}
        {telegram && (
          <button type="button" aria-label="Telegram" onClick={() => openExternal(telegram)} className={icon}>
            <Send size={18} />
          </button>
        )}
        {website && (
          <button type="button" aria-label="Website" onClick={() => openExternal(website)} className={icon}>
            <Globe size={18} />
          </button>
        )}
      </div>
      {facts.length > 0 && <div className="mt-2 text-base text-mute">{facts.join(" · ")}</div>}
    </div>
  );
}
const compact = (n: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);

/** About for coins the memecoin terminal does not track (majors, stocks, older tokens). Free public data: DexScreener and CoinGecko. */
function AboutAssetCard({ kind, name, symbol }: { kind: CoinRef["kind"]; name: string; symbol: string }) {
  const about = assetAbout(kind, name, symbol);
  if (!about) return null;
  return (
    <div className="card mt-4 p-4">
      <div className="font-display text-lg font-bold">{about.title}</div>
      {about.lines.map((l) => (
        <p key={l} className="mt-2 text-base leading-relaxed text-mute">
          {l}
        </p>
      ))}
    </div>
  );
}

function CoinInfo({ mint, symbol, name, kind, onSeeHolders }: { mint: string; symbol: string; name: string; kind: CoinRef["kind"]; onSeeHolders: () => void }) {
  const [d, setD] = useState<CoinInfoData | null | undefined>(() => INFO_CACHE.get(mint)?.data);
  useEffect(() => {
    const hit = INFO_CACHE.get(mint);
    // Opened this coin a moment ago: show it, and do not ask again for 10 minutes.
    if (hit && Date.now() - hit.at < 10 * 60_000) return;
    let alive = true;
    fetch(`/api/backend/mini/info?mint=${mint}`)
      .then((r) => r.json())
      .then((j: CoinInfoData) => {
        INFO_CACHE.set(mint, { at: Date.now(), data: j });
        if (alive) setD(j);
      })
      .catch(() => alive && setD((p) => p ?? null));
    return () => {
      alive = false;
    };
  }, [mint]);

  if (d === undefined) return <div className="card mt-4 h-48 animate-pulse" />;
  if (!d || !d.found)
    return (
      <>
        <AboutAssetCard kind={kind} name={name} symbol={symbol} />
        <div className="card mt-4 px-4 py-8 text-center text-base text-mute">No market details for {symbol} yet.</div>
      </>
    );

  const stats: Array<[string, string | null]> = [
    ["Market cap", d.marketCap ? formatUsd(d.marketCap) : null],
    ["Fully diluted", d.fdv ? formatUsd(d.fdv) : null],
    ["Liquidity", d.liquidityUsd ? formatUsd(d.liquidityUsd) : null],
    ["Volume 24h", d.volume24hUsd ? formatUsd(d.volume24hUsd) : null],
    ["Circulating supply", d.circulatingSupply ? compact(d.circulatingSupply) : null],
    ["Total supply", d.totalSupply ? compact(d.totalSupply) : null],
    ["All-time high", d.athUsd ? `$${d.athUsd < 1 ? d.athUsd.toPrecision(3) : d.athUsd.toFixed(2)}${d.athChangePct != null ? ` (${d.athChangePct.toFixed(0)}%)` : ""}` : null],
    ["Rank", d.rank ? `#${d.rank}` : null],
    ["Trading since", d.createdAt ? new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : null],
  ];
  const shown = stats.filter(([, v]) => v);

  return (
    <>
      <AboutAssetCard kind={kind} name={name} symbol={symbol} />
      <HoldersSummary mint={mint} holders={null} onSeeAll={onSeeHolders} />
      {d.buys24h != null && d.sells24h != null && d.buys24h + d.sells24h > 0 && (
        <div className="mt-3 flex h-12 overflow-hidden rounded-2xl text-base font-bold">
          <div className="flex items-center bg-up/20 px-4 text-up" style={{ width: `${Math.max(18, Math.round((d.buys24h / (d.buys24h + d.sells24h)) * 100))}%` }}>
            {d.buys24h.toLocaleString("en-US")} buys
          </div>
          <div className="flex flex-1 items-center justify-end bg-down/20 px-4 text-down">{d.sells24h.toLocaleString("en-US")} sells</div>
        </div>
      )}
      {shown.length > 0 && (
        <div className="card mt-3 divide-y divide-white/10 px-4">
          {shown.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-3 text-base">
              <span className="text-mute">{k}</span>
              <span className="font-display font-bold">{v}</span>
            </div>
          ))}
        </div>
      )}
      {d.description && (
        <div className="card mt-3 p-4">
          <div className="font-display text-lg font-bold">About {symbol}</div>
          <p className="mt-1 text-base leading-relaxed text-mute">{d.description}</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {d.website && <LinkChip icon={<Globe size={18} />} label="Website" url={d.website} />}
        {d.twitter && (
          <button type="button" aria-label="X" onClick={() => openExternal(d.twitter!)} className="btn3d dark grid h-12 w-12 place-items-center !rounded-2xl font-display text-lg font-extrabold">
            X
          </button>
        )}
        {d.telegram && (
          <button type="button" aria-label="Telegram" onClick={() => openExternal(d.telegram!)} className="btn3d dark grid h-12 w-12 place-items-center !rounded-2xl">
            <Send size={18} />
          </button>
        )}
      </div>
      <p className="mt-3 text-base text-mute">Data from DexScreener and CoinGecko.</p>
    </>
  );
}

/** Big holder count on top of About, with how much the ten largest hold. Tap to see the full list. */
function HoldersSummary({ mint, holders, onSeeAll }: { mint: string; holders: number | null; onSeeAll: () => void }) {
  const [top10, setTop10] = useState<number | null>(null);
  const [counted, setCounted] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/backend/mini/holders?mint=${mint}`)
      .then((r) => r.json())
      .then((j: { count?: number | null; top10Pct?: number | null; holders?: Array<{ pct: number }> }) => {
        if (!alive) return;
        if (j.count != null) setCounted(j.count);
        setTop10(top10Of(j));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mint]);
  return (
    <button type="button" onClick={onSeeAll} className="card mt-4 flex w-full items-center justify-between p-5 text-left active:scale-[0.99]">
      <div>
        <div className="text-base text-mute">Holders</div>
        <div className="font-display text-5xl font-extrabold leading-none">{(holders ?? counted) != null ? (holders ?? counted)!.toLocaleString("en-US") : "-"}</div>
      </div>
      <div className="text-right">
        {top10 != null && (
          <>
            <div className="text-base text-mute">Top 10 hold</div>
            <div className="font-display text-2xl font-extrabold">{`${top10.toFixed(top10 >= 10 ? 0 : 1)}%`}</div>
          </>
        )}
        <div className="text-base font-semibold text-up">See all</div>
      </div>
    </button>
  );
}

const BUY_PRESETS = ["5", "10", "25"];
const SELL_PRESETS = [25, 50, 100];
const SLIPPAGE_BPS = 300;
/** Left in the wallet on a max buy so the user can still pay network fees and open the token account. */
const SOL_RESERVE = 0.01;
/** Kept when selling SOL itself, for the network fee of that sale. The 0.01 above also has to cover a new token account on a buy. */
const SOL_SELL_RESERVE = 0.002;

type Side = "buy" | "sell";

/**
 * Full screen coin page. Scrolls for info and safety checks, while the trade dock stays pinned to
 * the bottom so Buy and Sell are always one thumb away.
 */
export function CoinPage({ coin, onClose, startSide = "buy" }: { coin: CoinRef; onClose: () => void; startSide?: Side }) {
  const { address, wallet, userId, getAccessToken, signTransaction } = useWallet();
  const [side, setSide] = useState<Side>(startSide);
  const [amount, setAmount] = useState("");
  const [solBal, setSolBal] = useState<number | null>(null);
  const [usdcBal, setUsdcBal] = useState<number | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [tokBal, setTokBal] = useState<number | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sig: string; out: string; side: Side } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemecoinDetail | null>(null);
  const reqId = useRef(0);
  const [tab, setTab] = useState<"chat" | "trades" | "holders" | "info">("chat");
  const [riskOpen, setRiskOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const [copied, setCopied] = useState(false);
  const trades = useLiveTrades(coin.mint);

  // Lock page scroll behind the full screen view.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Safety checks only exist for coins the terminal tracks. Anything else just skips this block.
  useEffect(() => {
    let alive = true;
    fetchMemecoinDetail(coin.mint)
      .then((d) => alive && setDetail(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [coin.mint]);

  const loadBalances = useCallback(async () => {
    if (!address) return;
    try {
      const [s, t, u] = await Promise.all([getSolBalance(address), getTokenBalance(address, coin.mint), getTokenBalance(address, USDC)]);
      setSolBal(s);
      setUsdcBal(u);
      setTokBal(t);
    } catch {
      /* balances are a convenience, the swap itself still works */
    }
  }, [address, coin.mint]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  // Buys are typed in dollars. The SOL price turns that into the amount the swap needs.
  useEffect(() => {
    let alive = true;
    getSolUsd().then((v) => alive && setSolUsd(v)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const item = detail ?? coin.item ?? null;
  const typed = Number(amount);
  // A coin that is still on the Pump curve trades against Pump's own program, paid in SOL. If the backend says this
  // one cannot (graduated, or quoted in another token), pumpOff is set and the normal Jupiter route takes over.
  const [pumpOff, setPumpOff] = useState(false);
  const usePump = coin.mint.endsWith("pump") && item?.stage.key !== "grad" && !pumpOff;
  // Buys spend USDC cash first (a dollar is a dollar), and fall back to SOL when there is not enough USDC.
  // SOL itself is native: you cannot swap SOL for SOL, so buying SOL always spends USDC and selling it pays out USDC.
  const isSol = coin.mint === WSOL;
  const buyWithUsdc = !usePump && side === "buy" && (isSol || ((usdcBal ?? 0) >= typed && typed > 0));
  const inputMint = side === "buy" ? (buyWithUsdc ? USDC : WSOL) : coin.mint;
  // Sells always pay out dollars. The backend sponsors the network fee, so a wallet with no SOL can still sell.
  const outputMint = side === "buy" ? coin.mint : USDC;
  // What the swap actually spends: SOL for a buy (dollars / SOL price), coin units for a sell.
  const swapNum = side === "buy" ? (buyWithUsdc ? typed : solUsd ? typed / solUsd : 0) : typed;
  const swapAmount = side === "buy" ? (swapNum > 0 ? String(Number(swapNum.toFixed(9))) : "") : amount;
  // The SOL coin is held as native SOL, not wrapped, and a little stays behind for fees.
  const sellBal = isSol ? Math.max(0, (solBal ?? 0) - SOL_SELL_RESERVE) : tokBal;
  const balance = side === "buy" ? (isSol ? usdcBal : solBal) : sellBal;
  const maxSol = Math.max(0, (solBal ?? 0) - SOL_RESERVE);
  const maxSolUsd = maxSol * (solUsd ?? 0);
  const maxAmount = side === "buy" ? (isSol ? (usdcBal ?? 0) : usePump ? maxSolUsd : Math.max(usdcBal ?? 0, maxSolUsd)) : (sellBal ?? 0);
  const over = balance != null && (side === "buy" ? typed > maxAmount + 1e-9 : swapNum > (sellBal ?? 0) + 1e-12);
  const showOut = (outAmount: string, outDecimals: number) => {
    const out = baseToHuman(outAmount, outDecimals);
    return side === "buy" ? `${fmt(out)} ${coin.symbol}` : `$${fmt(out, 2)}`;
  };
  const digits = Math.min(coin.decimals, 9);

  useEffect(() => {
    setQuote(null);
    setQuoteErr(null);
    if (!(Number(swapAmount) > 0) || !userId) return;
    const id = ++reqId.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const token = await getAccessToken();
        const q = usePump
          ? await quotePump({ mint: coin.mint, side, amount: swapAmount, slippageBps: SLIPPAGE_BPS }, token)
          : await quoteSwap({ inputMint, outputMint, amount: swapAmount, slippageBps: SLIPPAGE_BPS }, token);
        if (reqId.current === id) setQuote(q);
      } catch (e) {
        const msg = e instanceof Error && e.message.startsWith(PUMP_UNSUPPORTED) ? e.message : humanError(e, "No route found");
        // Not tradable on the curve: switch to Jupiter. The effect runs again with the new route.
        if (msg.startsWith(PUMP_UNSUPPORTED)) {
          if (reqId.current === id) setPumpOff(true);
          return;
        }
        if (reqId.current === id) setQuoteErr(msg);
      } finally {
        if (reqId.current === id) setQuoting(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [swapAmount, inputMint, outputMint, userId, getAccessToken, usePump, side, coin.mint]);

  const trade = async () => {
    if (!wallet || !quote || over || busy) return;
    setBusy(true);
    setError(null);
    haptic("tap");
    try {
      const token = await getAccessToken();
      const built = usePump
        ? await buildPump({ mint: coin.mint, side, amount: swapAmount, slippageBps: SLIPPAGE_BPS }, token)
        : await buildSwap({ inputMint, outputMint, amount: swapAmount, slippageBps: SLIPPAGE_BPS }, token);
      const { signedTransaction } = await signTransaction({
        transaction: b64ToBytes(built.swapTransaction),
        wallet,
        chain: "solana:mainnet",
        options: { uiOptions: { showWalletUIs: false } },
      });
      let sig: string;
      if (built.gasless && built.id) {
        ({ signature: sig } = await submitSwap({ id: built.id, signedTransaction: bytesToB64(signedTransaction) }, token));
      } else {
        sig = await getConnection().sendRawTransaction(signedTransaction, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
        await waitForConfirmation(sig);
        void reportTrade(built.tradeId, sig, token);
      }
      haptic("success");
      setDone({ sig, side, out: showOut(built.outAmount, built.outDecimals) });
      void loadBalances();
    } catch (e) {
      const msg = e instanceof Error && e.message.startsWith(PUMP_UNSUPPORTED) ? e.message : humanError(e, "Trade failed");
      // The curve refused at build time: use Jupiter from now on and let the person tap again.
      if (msg.startsWith(PUMP_UNSUPPORTED)) {
        setPumpOff(true);
        setError("Switched to another route. Tap again.");
      } else if (!/reject|cancel|denied/i.test(msg)) {
        haptic("error");
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onLaunchpad = item?.status === "launchpad";
  // Selling SOL with almost nothing above the network fee: say why, instead of a 100% button that does nothing.
  const tooLittleSol = side === "sell" && isSol && solBal != null && (sellBal ?? 0) < 0.0005;
  const problem = tooLittleSol ? "Too little SOL to sell. About 0.002 SOL stays for the network fee." : over ? "Not enough balance" : error || (quoteErr ? (onLaunchpad && pumpOff ? "This coin cannot be traded in the app right now." : quoteErr) : null);
  const impact = quote ? Math.abs(quote.priceImpactPct) * 100 : null;
  const change = formatChange(coin.change);

  return (
    <div className="anim-fade fixed inset-0 z-50 flex flex-col bg-bg md:inset-y-8 md:left-1/2 md:right-auto md:w-[min(760px,calc(100vw-48px))] md:-translate-x-1/2 md:overflow-hidden md:rounded-3xl md:border md:border-white/10 md:shadow-[0_0_0_100vmax_rgba(0,0,0,0.72)]">
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 pb-2" style={{ paddingTop: "calc(var(--safe-top) + 12px)" }}>
        <button type="button" onClick={onClose} aria-label="Back" className="btn3d dark grid h-12 w-12 shrink-0 place-items-center !rounded-2xl">
          <ArrowLeft size={22} />
        </button>
        <Avatar mint={coin.mint} symbol={coin.symbol} src={coin.icon} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-extrabold leading-tight">{coin.name}</div>
          <div className="truncate text-base text-mute">
            {[item && (formatAgeAt(item.createdAt, now) ?? formatAge(item.ageMinutes)), item?.holders != null ? `${item.holders.toLocaleString("en-US")} holders` : null].filter(Boolean).join(" · ") || coin.symbol}
          </div>
        </div>
      </div>

      {/* scrollable info */}
      <div className="flex-1 overflow-y-auto px-4 pb-[250px]">
        <div className="flex items-end gap-3 pt-2">
          <div className="font-display text-5xl font-extrabold tracking-tight">{coin.mcap != null ? formatUsd(coin.mcap) : coin.usd != null ? `$${fmt(coin.usd, 6)}` : "-"}</div>
          {coin.change != null && (
            <span style={{ color: change.color }} className="pb-1 font-display text-xl font-bold">
              {change.text}
            </span>
          )}
        </div>
        <div className="mt-1 text-base text-mute">{coin.mcap != null ? "Market cap" : "Price"}</div>

        <CoinMeta mint={coin.mint} item={item} now={now} />

        <LiveChart mint={coin.mint} trades={trades} price={coin.usd ?? (coin.mcap != null ? coin.mcap / 1_000_000_000 : null)} />

        <div className="mt-4">
          <Segmented
            value={tab}
            onChange={(t) => {
              haptic("tap");
              setTab(t);
            }}
            options={[
              { id: "chat", label: "Takes" },
              { id: "trades", label: "Trades" },
              { id: "holders", label: "Holders" },
              { id: "info", label: "Info" },
            ]}
          />
        </div>

        {tab === "chat" && <ChatPanel mint={coin.mint} name={coin.name} price={trades[0]?.price ?? coin.usd} myHoldingUsd={tokBal != null && (trades[0]?.price ?? coin.usd) != null ? tokBal * (trades[0]?.price ?? coin.usd ?? 0) : null} />}
        {tab === "trades" && <TradesList trades={trades} />}
        {tab === "holders" && <HoldersList mint={coin.mint} />}

        {tab === "info" && item && (
          <>
            {/* holders first: the number people look at before anything else */}
            <HoldersSummary mint={coin.mint} holders={item.holders} onSeeAll={() => setTab("holders")} />

            {/* how far along the coin is */}
            <div className="card mt-4 p-5">
              <div className="text-base text-mute">{STAGE_STYLE[item.stage.key].title}</div>
              <div className="mt-1 flex items-end justify-between gap-3">
                <div className="font-display text-6xl font-extrabold leading-none">{item.stage.key === "grad" ? "100" : item.stage.percent}%</div>
                <button type="button" onClick={() => setRiskOpen(true)} className="flex items-center gap-2 pb-1 text-base text-mute">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: RISK_STYLE[item.risk].color }} />
                  {RISK_STYLE[item.risk].label}
                  <span className="grid h-8 w-8 place-items-center rounded-full border border-white/15 font-bold">?</span>
                </button>
              </div>
              <div className="mt-4 h-4 overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${item.stage.key === "grad" ? 100 : Math.max(4, item.stage.percent)}%`,
                    background: item.stage.key === "grad" ? "linear-gradient(90deg,#2f9e63,#3cb371)" : "linear-gradient(90deg,#ff3d14,#ff8a3a)",
                    boxShadow: item.stage.key === "grad" ? "0 0 14px rgba(60,179,113,0.5)" : "0 0 14px rgba(255,90,26,0.6)",
                  }}
                />
              </div>
              <div className="mt-3 flex justify-between gap-3 text-base">
                <span className="font-semibold">{coin.mcap != null ? formatUsd(coin.mcap) : "-"}</span>
                <span className="text-mute">{item.stage.key === "grad" ? "On the open market" : `Graduates at ${formatUsd(item.goalMcapUsd ?? 69_000)}`}</span>
              </div>
            </div>

            {/* three numbers */}
            <div className="card mt-3 grid grid-cols-3 divide-x divide-white/10 py-4 text-center">
              <div>
                <div className="font-display text-xl font-bold">{formatUsd(item.volume24hUsd)}</div>
                <div className="text-base text-mute">Vol 24h</div>
              </div>
              <div>
                <div className="font-display text-xl font-bold">{item.holders != null ? item.holders.toLocaleString("en-US") : "-"}</div>
                <div className="text-base text-mute">Holders</div>
              </div>
              <div>
                <div className="font-display text-xl font-bold">{item.buys != null && item.sells != null && item.buys + item.sells > 0 ? `${Math.round((item.buys / (item.buys + item.sells)) * 100)}%` : "-"}</div>
                <div className="text-base text-mute">Buying</div>
              </div>
            </div>

            {/* buys against sells */}
            {item.buys != null && item.sells != null && item.buys + item.sells > 0 && (
              <div className="mt-3 flex h-12 overflow-hidden rounded-2xl text-base font-bold">
                <div className="flex items-center bg-up/20 px-4 text-up" style={{ width: `${Math.max(18, Math.round((item.buys / (item.buys + item.sells)) * 100))}%` }}>
                  {item.buys.toLocaleString("en-US")} buys
                </div>
                <div className="flex flex-1 items-center justify-end bg-down/20 px-4 text-down">{item.sells.toLocaleString("en-US")} sells</div>
              </div>
            )}

            {/* links and the address */}
            <div className="mt-3 flex flex-wrap gap-2">
              {item.website && <LinkChip icon={<Globe size={18} />} label="Website" url={item.website} />}
              {item.twitter && (
                <button type="button" aria-label="X" onClick={() => openExternal(item.twitter!)} className="btn3d dark grid h-12 w-12 place-items-center !rounded-2xl font-display text-lg font-extrabold">
                  X
                </button>
              )}
              {item.telegram && (
                <button type="button" aria-label="Telegram" onClick={() => openExternal(item.telegram!)} className="btn3d dark grid h-12 w-12 place-items-center !rounded-2xl">
                  <Send size={18} />
                </button>
              )}
              <button
                type="button"
                aria-label="Copy address"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(coin.mint);
                    haptic("success");
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* clipboard can be blocked in some webviews */
                  }
                }}
                className="btn3d dark grid h-12 w-12 place-items-center !rounded-2xl"
              >
                {copied ? <Check size={18} className="text-up" /> : <Copy size={18} />}
              </button>
            </div>
          </>
        )}
        {tab === "info" && !item && <CoinInfo mint={coin.mint} symbol={coin.symbol} name={coin.name} kind={coin.kind} onSeeHolders={() => setTab("holders")} />}
      </div>

      {riskOpen && item && (
        <Sheet title="Risk check" onClose={() => setRiskOpen(false)}>
          <div className="mt-3">
            <div className="flex items-center gap-3">
              <Tile tone="brand" size={44}>
                <ShieldCheck size={24} className="text-white" />
              </Tile>
              <div className="font-display text-lg font-bold">{RISK_STYLE[item.risk].label}</div>
            </div>
            <p className="mt-3 text-base leading-snug text-mute">{detail?.riskSummary ?? "Lower risk means no wallet owns a big share and few buys were bundled together. High risk means the opposite, or the coin was flagged as a rug."}</p>
            {detail && (
              <ul className="mt-4 space-y-3">
                {detail.checks.map((c) => (
                  <li key={c.title} className="flex gap-3">
                    <span className="mt-2 h-3 w-3 shrink-0 rounded-full" style={{ background: CHECK_DOT[c.status] }} />
                    <div>
                      <div className="text-base font-semibold">{c.title}</div>
                      <div className="text-base leading-snug text-mute">{c.why}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-base text-mute">This is not advice and not a guarantee. Meme coins can drop to zero.</p>
            <button type="button" onClick={() => setRiskOpen(false)} className="btn3d dark mt-4 h-16 w-full text-lg">
              Got it
            </button>
          </div>
        </Sheet>
      )}

      {/* pinned trade dock */}
      <div
        className="absolute inset-x-0 bottom-0 z-30 rounded-t-[28px] border-t border-white/10 bg-[#141418] px-4 pt-4"
        style={{ paddingBottom: "calc(var(--safe-bottom) + 16px)", boxShadow: "0 -20px 40px rgba(0,0,0,0.5)" }}
      >
        {done ? (
          <div className="relative flex flex-col items-center gap-2 py-2 text-center">
            <ConfettiBurst />
            <div className="anim-pop tile3d green grid h-20 w-20 place-items-center rounded-[28px] text-white">
              <Check size={42} strokeWidth={3} />
            </div>
            <div className="font-display text-2xl font-extrabold">{done.side === "buy" ? "Bought" : "Sold"}</div>
            <div className="text-base text-mute">You received {done.out}</div>
            <button type="button" onClick={() => openExternal(`https://solscan.io/tx/${done.sig}`)} className="flex h-11 items-center gap-2 text-base font-semibold">
              <ExternalLink size={16} /> View transaction
            </button>
            <button type="button" onClick={onClose} className="btn3d mt-1 h-14 w-full text-lg">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              {side === "buy"
                ? BUY_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setAmount(p);
                        setCustomOpen(false);
                      }}
                      className={clsx("btn3d dark h-12 !rounded-2xl font-display text-base font-bold", amount === p && !customOpen && "!border-up !text-up")}
                    >
                      ${p}
                    </button>
                  ))
                : SELL_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        const v = ((sellBal ?? 0) * p) / 100;
                        setAmount(v > 0 ? String(Number(v.toFixed(digits))) : "");
                        setCustomOpen(false);
                      }}
                      className="btn3d dark h-12 !rounded-2xl font-display text-base font-bold"
                    >
                      {p}%
                    </button>
                  ))}
              <button type="button" onClick={() => setCustomOpen((v) => !v)} className={clsx("btn3d dark h-12 !rounded-2xl font-display text-base font-bold", customOpen && "!border-up !text-up")}>
                Custom
              </button>
            </div>

            {customOpen && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex h-14 min-w-0 flex-1 items-center rounded-2xl bg-surface px-4">
                  {side === "buy" && <span className="shrink-0 pr-1 font-display text-xl font-bold text-mute">$</span>}
                  <input
                    inputMode="decimal"
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0.0"
                    className="h-full min-w-0 flex-1 bg-transparent font-display text-xl font-bold outline-none placeholder:text-mute/50"
                  />
                  <span className="shrink-0 pl-2 text-base font-semibold text-mute">{side === "buy" ? "USD" : coin.symbol}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAmount(maxAmount > 0 ? String(side === "buy" ? Math.floor(maxAmount * 100) / 100 : Number(maxAmount.toFixed(digits))) : "")}
                  className="btn3d dark h-14 shrink-0 px-5 !rounded-2xl text-base"
                >
                  Max
                </button>
              </div>
            )}

            <div className="mt-3 flex min-h-[28px] items-center justify-center text-center text-base text-mute">
              {problem ? (
                <span className="text-down">{problem}</span>
              ) : (
                <span>
                  {quoting ? "..." : quote ? `\u2248 ${showOut(quote.outAmount, quote.outDecimals)}` : "Enter an amount"} · fee {quote ? (quote.feeBps / 100).toFixed(2) : "0.30"}%
                  {impact != null && impact >= 1 && <span className={clsx("ml-2", impact >= 5 && "text-down")}>Impact {impact.toFixed(1)}%</span>}
                </span>
              )}
            </div>

            <div className="mt-2 flex gap-2">
              <button type="button" disabled={!quote || over || busy || !wallet} onClick={trade} className={clsx("btn3d flex h-16 min-w-0 flex-1 items-center justify-center gap-2 text-lg", side === "buy" ? "up" : "down")}>
                {busy && <Loader2 size={20} className="animate-spin" />}
                {busy ? "Confirming" : side === "buy" ? `Buy${typed > 0 ? ` $${amount}` : ""}` : "Sell"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSide(side === "buy" ? "sell" : "buy");
                  setAmount("");
                  setError(null);
                  haptic("tap");
                }}
                className="btn3d dark h-16 w-28 shrink-0 text-lg"
              >
                {side === "buy" ? "Sell" : "Buy"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-3 py-3 text-center">
      <div className="font-display text-lg font-bold">{value}</div>
      <div className="text-base text-mute">{label}</div>
    </div>
  );
}

function LinkChip({ icon, label, url }: { icon: React.ReactNode; label: string; url: string }) {
  return (
    <button type="button" onClick={() => openExternal(url)} className="flex h-12 items-center gap-2 rounded-2xl bg-surface px-4 text-base font-semibold">
      {icon}
      {label}
    </button>
  );
}
