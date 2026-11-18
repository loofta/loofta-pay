"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { clientApiBase } from "@/services/api/client";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { manrope, sora } from "@/components/home-v4/fonts";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { MeldFlow } from "@/components/deposit/MeldFlow";
import { PEER_PLATFORMS } from "@/lib/peerPlatforms";
import { TokenCombobox } from "@/components/TokenCombobox";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { findUsdcOnSolana } from "@/lib/depositRails";
import { findTokenBySelection, formatChainLabel } from "@/lib/tokens";
import { isValidAddressForChain } from "@/lib/refundAddresses";
import type { TokenSelection } from "@/app/utils/types";

const BACKEND = clientApiBase();
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SORA = "var(--font-home-sora), Sora, sans-serif";

type PublicPartner = {
  org_id: string;
  name: string;
  description?: string | null;
  logo_url: string | null;
  brand_color: string | null;
  withdraw_min_usd: number;
  fee_fixed_usd: number;
  fee_percent_bps: number;
};
type PayoutView = { payment_id: string; amount: number; message: string | null; created_at: string };
type Quote = {
  partner: PublicPartner;
  available: PayoutView[];
  processing: PayoutView[];
  gross_usdc: number;
  partner_fee_usdc: number;
  loofta_fee_usdc: number;
  net_usdc: number;
  min_usd: number;
  can_withdraw: boolean;
  reason: string | null;
};

/** The same four ways out as the Loofta withdraw screen. Every one ends in the recipient's own wallet first. */
type Method = "usdc" | "token" | "bank" | "p2p";
type Group = "crypto" | "cash";
// "cash" opens the Loofta bank and card screen, with every cash-out route that is available.
const NEXT_METHOD: Partial<Record<Method, "crypto" | "peer">> = { token: "crypto", p2p: "peer" };

const METHODS: Record<Method, { title: string; hint: string; badge?: string; icons: { src: string; bg: string }[] }> = {
  usdc: { title: "USDC on Solana", hint: "To any Solana wallet", badge: "Fastest", icons: [{ src: "/images/usdc.svg", bg: "#2775CA" }, { src: "/images/logo/solana-mark.svg", bg: "#111" }] },
  token: { title: "Other tokens", hint: "BTC, ETH, ZEC, and other chains", icons: [{ src: "/images/btc.svg", bg: "#F7931A" }, { src: "/images/eth.svg", bg: "#627EEA" }] },
  bank: { title: "Bank or cards", hint: "Bank account, debit card or PAJ Cash", icons: [{ src: "/images/icons/card-chip.svg", bg: "#1C1C22" }] },
  p2p: { title: "Private P2P", hint: "Revolut, Venmo, Cash App and more", icons: [{ src: "/images/platforms/revolut.png", bg: "#1C1C22" }, { src: "/images/platforms/venmo.png", bg: "#008CFF" }] },
};
const GROUPS: Record<Group, Method[]> = { crypto: ["usdc", "token"], cash: ["bank", "p2p"] };

const isSol = (c?: string) => !!c && ["sol", "solana"].includes(c.toLowerCase());
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Same row as the Loofta withdraw screen, so both look identical. */
function MethodRow({ method, onClick }: { method: Method; onClick: () => void }) {
  const m = METHODS[method];
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#1A1A20] px-3.5 py-3.5 text-left hover:border-white/20">
      <span className="flex shrink-0">
        {m.icons.map((icon, i) => (
          <span key={icon.src} className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl border-2 border-[#1A1A20]" style={{ background: icon.bg, marginLeft: i ? -10 : 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon.src} alt="" className="h-5 w-5 object-contain" />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-base font-bold text-white" style={{ fontFamily: SORA }}>{m.title}</span>
          {m.badge && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-sm font-semibold text-emerald-400">{m.badge}</span>}
        </span>
        <span className="block text-sm text-[#8A8893]">{m.hint}</span>
      </span>
      <span className="text-[#8A8893]">→</span>
    </button>
  );
}

function WithdrawContent() {
  const orgId = useSearchParams().get("orgId") ?? "";
  const { ready, authenticated, login, logout, getAccessToken, email } = useAuth();
  const [brand, setBrand] = useState<PublicPartner | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** What the page is doing right now, so a payout that has to pass through the Loofta wallet never looks stuck. */
  const [stage, setStage] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("crypto");
  const [method, setMethod] = useState<Method | null>(null);
  const [wallet, setWallet] = useState("");
  const [platformId, setPlatformId] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const { data: tokens = [] } = useTokensQuery();
  const [tokenSel, setTokenSel] = useState<TokenSelection | undefined>(undefined);
  const [tokenAddr, setTokenAddr] = useState("");
  // Bank or cards runs right here once the payout is ready, so it needs the person's own wallet and what landed in it.
  const { wallets: solanaWallets } = useSolanaWallets();
  const [bankOpen, setBankOpen] = useState(false);
  const [bankBalance, setBankBalance] = useState(0);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      const res = await fetch(`${BACKEND}/${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body?.message || "Something went wrong."), { status: res.status });
      return body;
    },
    [getAccessToken],
  );

  // Branding is public, so the page carries the partner's name and logo even before sign-in.
  useEffect(() => {
    if (!orgId) return;
    fetch(`${BACKEND}/partners/public/${encodeURIComponent(orgId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setBrand)
      .catch(() => setError("We could not find this partner."));
  }, [orgId]);

  const loadQuote = useCallback(async () => {
    try {
      setQuote(await call(`partner-withdraw/${encodeURIComponent(orgId)}/quote`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your payouts.");
    }
  }, [call, orgId]);

  useEffect(() => {
    if (ready && authenticated && orgId) void loadQuote();
  }, [ready, authenticated, orgId, loadQuote]);

  const name = brand?.name ?? "your partner";
  const platform = PEER_PLATFORMS.find((p) => p.id === platformId) ?? null;
  const p2pOk = method !== "p2p" || (!!platform && handle.trim().length > 1 && (!platform.maxUSDC || (quote?.net_usdc ?? 0) <= platform.maxUSDC));
  const usdcSol = findUsdcOnSolana(tokens);
  // Same list as the Loofta "Any crypto" withdrawal: every token on every chain except USDC on Solana.
  const tokenChoices = tokens.filter((t) => !isSol(t.chain) && (!usdcSol || t.tokenId !== usdcSol.tokenId));
  const token = findTokenBySelection(tokens, tokenSel);
  const tokenOk = method !== "token" || (!!token && isValidAddressForChain(tokenAddr.trim(), token.chain));
  const walletOk = (method !== "usdc" || SOLANA_ADDRESS.test(wallet.trim())) && p2pOk && tokenOk;
  const hasPayouts = !!quote && quote.gross_usdc > 0;
  const belowMin = hasPayouts && !!quote && quote.gross_usdc < quote.min_usd;
  const fees = quote ? quote.partner_fee_usdc + quote.loofta_fee_usdc : 0;

  const back = () => {
    setMethod(null);
    setNotice(null);
  };

  async function confirm() {
    if (!quote || !method) return;
    setBusy(true);
    setNotice(null);
    setStage(method === "usdc" ? "Sending..." : "Preparing...");
    let navigating = false;
    let keepQuote = false;
    try {
      const out = await call(`partner-withdraw/${encodeURIComponent(orgId)}/confirm`, {
        method: "POST",
        body: JSON.stringify({ max_fee_usdc: quote.partner_fee_usdc, ...(method === "usdc" ? { destination_address: wallet.trim() } : {}) }),
      });
      const sent = (out.results as Array<{ ok: boolean }>).filter((r) => r.ok).length;
      const failed = out.results.length - sent;
      if (failed) {
        setNotice(`${sent} sent, ${failed} could not be sent yet. Try again in a minute.`);
      } else {
        setNotice(method === "usdc" ? `Sent ${sent} payout${sent === 1 ? "" : "s"}.` : null);
        // Tokens, bank and P2P need the recipient's own wallet to sign, so they finish in the usual Loofta withdraw screen.
        if (method === "bank") {
          // Hand over to the bank and card options on this same page, with what was just paid out.
          setBankBalance(quote.net_usdc);
          setBankOpen(true);
          keepQuote = true;
          return;
        }
        const next = NEXT_METHOD[method];
        if (next) {
          navigating = true;
          const home = window.location.pathname.startsWith("/app") ? "/app" : "/";
          // P2P carries the platform, handle and amount, so the cash-out opens already filled in.
          const extra = method === "p2p" && platform
            ? `&platform=${encodeURIComponent(platform.id)}&to=${encodeURIComponent(handle.trim())}&amount=${encodeURIComponent(quote.net_usdc.toFixed(2))}`
            : "";
          const tokenExtra = method === "token" && token
            ? `&symbol=${encodeURIComponent(token.symbol)}&chain=${encodeURIComponent(token.chain)}&to=${encodeURIComponent(tokenAddr.trim())}&amount=${encodeURIComponent(quote.net_usdc.toFixed(2))}`
            : "";
          window.location.assign(`${home}?balance=withdraw&method=${next}${extra}${tokenExtra}`);
          return;
        }
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Withdrawal failed.");
    } finally {
      // While moving on to the Loofta wallet the button keeps saying so, instead of flashing back to idle.
      if (!navigating) {
        setBusy(false);
        setStage(null);
        if (!keepQuote) await loadQuote();
      }
    }
  }

  return (
    <div
      className={`${sora.variable} ${manrope.variable} flex min-h-[calc(100vh-var(--header-h,0px))] flex-col items-center justify-center bg-[#0f0f12] px-4 py-10 text-[#F2EFE8]`}
      style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}
    >
      <div className="w-full max-w-[480px]">
        <div className="rounded-[28px] border border-white/10 bg-[#141418] p-5 shadow-2xl">
          <div className="flex items-center gap-3">
            {brand?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_url} alt="" className="h-10 w-10 rounded-xl object-cover" referrerPolicy="no-referrer" />
            )}
            <p className="truncate text-base font-bold text-white" style={{ fontFamily: SORA }}>{brand ? `${brand.name} payouts` : "Your payouts"}</p>
          </div>

          {!orgId && <p className="mt-5 text-base text-[#C8C6D0]">This page needs the link from the email {name} sent you.</p>}
          {error && <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-base text-[#C8C6D0]">{error}</p>}
          {orgId && !error && !ready && <p className="mt-5 text-base text-[#8A8893]">Loading...</p>}

          {orgId && !error && ready && !authenticated && (
            <>
              <p className="mt-5 text-base leading-relaxed text-[#C8C6D0]">
                Sign in with the email address {name} sent your payout to. We email you a code, so only the person who was paid can withdraw.
              </p>
              <GradientActionButton className="mt-5" onClick={() => void login({ loginMethods: ["email"], disableSignup: false })}>
                Continue with email
              </GradientActionButton>
            </>
          )}

          {authenticated && (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-[#0E0E12] px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-[#8A8893]">Payouts for</p>
                <p className="truncate text-base font-semibold text-white">{email ?? "your account"}</p>
              </div>
              <button type="button" onClick={() => void logout()} className="shrink-0 text-sm text-[#8A8893] transition-colors hover:text-white">
                Not you? Sign out
              </button>
            </div>
          )}

          {authenticated && bankOpen && solanaWallets[0]?.address && (
            <div className="mt-6">
              <MeldFlow
                side="sell"
                solanaAddress={solanaWallets[0].address}
                balanceNum={bankBalance}
                getAccessToken={getAccessToken}
                onBack={() => {
                  setBankOpen(false);
                  setMethod(null);
                  void loadQuote();
                }}
              />
            </div>
          )}

          {authenticated && !bankOpen && quote && !hasPayouts && quote.processing.length === 0 && (
            <p className="mt-5 text-base leading-relaxed text-[#C8C6D0]">
              There is nothing to withdraw for {email ?? "this account"} yet. If {name} paid a different email address, sign out and sign in with that one.
            </p>
          )}

          {authenticated && !bankOpen && quote && (hasPayouts || quote.processing.length > 0) && (
            <>
              <div className="mt-6">
                <p className="text-[40px] font-bold leading-none tracking-tight text-white" style={{ fontFamily: SORA }}>{usd(quote.gross_usdc)}</p>
                <p className="mt-1.5 text-sm text-[#8A8893]">
                  Available to withdraw{quote.processing.length > 0 ? ` · ${usd(quote.processing.reduce((a, p) => a + p.amount, 0))} still processing` : ""}
                </p>
              </div>

              {belowMin && quote && (
                <p className="mt-5 rounded-2xl bg-[#0E0E12] px-4 py-3 text-base text-[#C8C6D0]">
                  The minimum withdrawal is {usd(quote.min_usd)}. You can withdraw once you have at least that much.
                </p>
              )}

              {hasPayouts && !belowMin && !method && (
                <div className="mt-6 flex flex-col gap-3">
                  <div className="grid grid-cols-2 rounded-full bg-[#0E0E12] p-1">
                    {(["crypto", "cash"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGroup(g)}
                        className={`rounded-full py-2 text-sm font-semibold ${group === g ? "bg-[#2A2A32] text-white" : "text-[#8A8893] hover:text-white"}`}
                      >
                        {g === "crypto" ? "Crypto" : "Cash"}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-sm font-semibold tracking-[0.14em] text-[#8A8893]">SEND FUNDS TO</p>
                  {GROUPS[group].map((m) => (
                    <MethodRow key={m} method={m} onClick={() => setMethod(m)} />
                  ))}
                </div>
              )}

              {hasPayouts && !belowMin && method && (
                <div className="mt-6">
                  <button type="button" onClick={back} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#C8C6D0] hover:text-white">
                    <ArrowLeft className="h-4 w-4" aria-hidden /> {METHODS[method].title}
                  </button>

                  {method === "usdc" ? (
                    <div className="flex flex-col gap-2">
                      <label htmlFor="partner-withdraw-wallet" className="text-sm font-semibold text-[#8A8893]">Solana wallet address</label>
                      <input
                        id="partner-withdraw-wallet"
                        value={wallet}
                        onChange={(e) => setWallet(e.target.value)}
                        placeholder="Paste any Solana wallet address"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full rounded-2xl border border-white/10 bg-[#0E0E12] px-4 py-3 text-base text-white outline-none focus:border-[#FF7A2A]/60"
                      />
                      {wallet.trim() !== "" && !SOLANA_ADDRESS.test(wallet.trim()) && <p className="text-sm text-[#FF8A5C]">That does not look like a Solana address.</p>}
                      <p className="text-sm text-[#8A8893]">Only send to a wallet that supports USDC on Solana. Check the address, it cannot be undone.</p>
                    </div>
                  ) : method === "token" ? (
                    <div className="flex flex-col gap-3">
                      <div>
                        <span className="text-sm text-[#8A8893]">You receive</span>
                        <div className="mt-1">
                          <TokenCombobox
                            tokens={tokenChoices}
                            value={tokenSel}
                            defaultShowAllChains
                            searchPlaceholder="Search BTC, ETH, ZEC…"
                            placeholder="Search a token"
                            onChange={(next) => {
                              setTokenSel(next);
                              setTokenAddr("");
                            }}
                          />
                        </div>
                      </div>
                      {token && (
                        <>
                          <input
                            value={tokenAddr}
                            onChange={(e) => setTokenAddr(e.target.value)}
                            placeholder={`${token.symbol} address on ${formatChainLabel(token.chain)}`}
                            aria-label={`${token.symbol} address`}
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full rounded-2xl border border-white/10 bg-[#0E0E12] px-4 py-3 text-base text-white outline-none focus:border-[#FF7A2A]/60"
                          />
                          {tokenAddr.trim() !== "" && !isValidAddressForChain(tokenAddr.trim(), token.chain) && (
                            <p className="text-sm text-[#FF8A5C]">That does not look like a {formatChainLabel(token.chain)} address.</p>
                          )}
                          
                        </>
                      )}
                    </div>
                  ) : method === "p2p" ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm font-semibold tracking-[0.14em] text-[#8A8893]">PICK AN APP</p>
                      <div className="grid grid-cols-2 gap-2.5">
                        {PEER_PLATFORMS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPlatformId(p.id)}
                            className={`flex items-center gap-2.5 rounded-2xl border px-3 py-3 text-left transition-colors ${platformId === p.id ? "border-[#FF7A2A]/60 bg-[#FF7A2A]/[0.06]" : "border-white/[0.07] bg-[#1A1A20] hover:border-white/20"}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.logo} alt="" className="h-8 w-8 shrink-0 rounded-lg bg-[#1C1C22] object-contain p-1" />
                            <span className="truncate text-base font-semibold text-white">{p.name}</span>
                          </button>
                        ))}
                      </div>
                      {platform && (
                        <>
                          <input
                            value={handle}
                            onChange={(e) => setHandle(e.target.value)}
                            placeholder={platform.placeholder}
                            aria-label={platform.idLabel}
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full rounded-2xl border border-white/10 bg-[#0E0E12] px-4 py-3 text-base text-white outline-none focus:border-[#FF7A2A]/60"
                          />
                          <p className="text-sm text-[#8A8893]">{platform.idLabel}</p>
                          {platform.maxUSDC && quote.net_usdc > platform.maxUSDC && <p className="text-sm text-[#FF8A5C]">{platform.name} allows up to {usd(platform.maxUSDC)} per cash-out.</p>}
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="text-base leading-relaxed text-[#C8C6D0]">Cash out to your bank account or card. You pick the option and see the exact amount you get on the next step.</p>
                  )}

                  <div className="mt-5 divide-y divide-white/10 rounded-2xl bg-[#0E0E12] px-4">
                    <div className="flex items-center justify-between py-3">
                      <span className="text-base text-[#8A8893]">Fees</span>
                      <span className="text-base text-[#C8C6D0]">{usd(fees)}</span>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <span className="text-base font-semibold text-white">You receive</span>
                      <span className="text-base font-semibold text-white">{usd(quote.net_usdc)}</span>
                    </div>
                  </div>

                  <GradientActionButton className="mt-5" onClick={() => void confirm()} disabled={busy || !quote.can_withdraw || !walletOk} loading={busy} loadingText={stage ?? "Sending..."}>
                    {method === "usdc" ? `Withdraw ${usd(quote.net_usdc)}` : method === "p2p" ? `Cash out ${usd(quote.net_usdc)}` : method === "token" ? `Swap ${usd(quote.net_usdc)}` : "Continue to bank or card"}
                  </GradientActionButton>
                  {quote.reason && <p className="mt-3 text-base text-[#C8C6D0]">{quote.reason}</p>}
                </div>
              )}

              {notice && <p className="mt-4 text-base text-[#F2EFE8]">{notice}</p>}
            </>
          )}
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-[#6E6C78]">
          <span>Powered by</span>
          <a href="https://loofta.com/" className="inline-flex items-center transition-opacity hover:opacity-90" aria-label="Loofta">
            <Image src="/loofta-white.svg" alt="Loofta" width={72} height={18} className="h-[18px] w-auto opacity-80" />
          </a>
        </div>
      </div>
    </div>
  );
}

export default function WithdrawPage() {
  return (
    <Suspense fallback={<div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12]" />}>
      <WithdrawContent />
    </Suspense>
  );
}
