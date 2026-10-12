"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useCreateWallet, usePrivy, useWallets as useEvmWallets } from "@privy-io/react-auth";
import { ChevronDown, ChevronLeft, Copy, Loader2, Shield, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { SolanaWalletConnectProvider, useWallet, WalletMultiButton } from "@/components/SolanaWalletConnect";
import { PajCashOnrampView } from "@/components/paj-cash/PajCashOnrampView";
import { sora, manrope } from "@/components/home-v4/fonts";
import { getDepositInfo, getExecutionStatus, type NearToken } from "@/services/nearIntents";
import { buildDirectPrivateDeposit, type PrivateTransferStatus } from "@/services/api/privateBalance";
import { buildUSDCTransferTransaction } from "@/services/solanaTransfer";
import { getEphemeralRpcForMode } from "@/lib/per/constants";
import { getRpcForMode, getUsdcMintForMode } from "@/lib/solanaRpc";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { isValidAddressForChain } from "@/lib/refundAddresses";
import { cn } from "@/lib/utils";
import { findUsdcOnBase, findUsdcOnSolana, readDepositPrivately, writeDepositPrivately } from "@/lib/depositRails";
import { totalWithMagicBlockPrivateFee } from "@/services/magicblockPrivateTransfer";
import { TokenCombobox } from "@/components/TokenCombobox";
import { findTokenBySelection, formatChainLabel } from "@/lib/tokens";
import type { TokenSelection } from "@/app/utils/types";

const PAJ_CASH_ENABLED = process.env.NEXT_PUBLIC_PAJ_CASH_ENABLED === "true";
const SORA = "var(--font-home-sora), Sora, sans-serif";
const SUCCESS = new Set(["SUCCESS", "COMPLETED"]);
const TERMINAL = new Set(["SUCCESS", "COMPLETED", "REFUNDED", "FAILED", "EXPIRED"]);

const DELAYS = [
  { id: "5m", label: "5 min", ms: 5 * 60_000 },
  { id: "30m", label: "30 min", ms: 30 * 60_000 },
  { id: "1h", label: "1 hour", ms: 60 * 60_000 },
  { id: "6h", label: "6 hours", ms: 6 * 60 * 60_000 },
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60_000 },
] as const;

const SPLITS = [
  { n: 1, label: "No split" },
  { n: 2, label: "2 parts" },
  { n: 4, label: "4 parts" },
  { n: 8, label: "8 parts" },
] as const;

type Screen = "home" | "solana" | "address" | "card" | "paj";
type CardProvider = "moonpay" | "coinbase" | "paj" | "revolut" | "venmo" | "cashapp";

const CARD_PROVIDERS: { id: CardProvider; name: string; hint: string; logo: string }[] = [
  { id: "moonpay", name: "MoonPay", hint: "Card · Apple Pay · Google Pay", logo: "/images/icons/moonpay-logo.svg" },
  { id: "coinbase", name: "Coinbase", hint: "From your Coinbase account", logo: "/images/icons/coinbase-logo.png" },
  { id: "paj", name: "PAJ Cash", hint: "Naira bank transfer", logo: "/images/icons/paj-cash-logo.svg" },
  { id: "revolut", name: "Revolut", hint: "From your Revolut account", logo: "/images/platforms/revolut.png" },
  { id: "venmo", name: "Venmo", hint: "From your Venmo balance", logo: "/images/platforms/venmo.png" },
  { id: "cashapp", name: "Cash App", hint: "From your Cash App balance", logo: "/images/platforms/cashapp.webp" },
];

export type DepositLaunch = {
  screen: Screen;
  /** Amount the deposit form should start with. Solana is USDC received. Other screens are the amount to send. */
  amount: string;
  privately?: boolean;
  card?: CardProvider;
  lockAmount?: boolean;
  /** Card checkout should buy this much USDC, so the provider adds its own fee on top. */
  receiveExactly?: boolean;
};

export function DepositSheet({
  open,
  onClose,
  balanceUsd,
  solanaAddress,
  devnetMode,
  onRefresh,
  launch,
}: {
  open: boolean;
  onClose: () => void;
  balanceUsd: string;
  solanaAddress: string | null;
  devnetMode: boolean;
  onRefresh?: () => void;
  launch?: DepositLaunch | null;
}) {
  const { toast } = useToast();
  const { user, getAccessToken } = usePrivy();
  const { data: tokens = [] } = useTokensQuery();
  const [screen, setScreen] = useState<Screen>("home");
  const [privately, setPrivately] = useState(true);
  const [solanaAmount, setSolanaAmount] = useState("");
  const [delayId, setDelayId] = useState<(typeof DELAYS)[number]["id"]>("5m");
  const [split, setSplit] = useState<number>(1);

  useEffect(() => {
    if (!open) return;
    if (launch) {
      setScreen(launch.screen);
      setPrivately(!!launch.privately);
      if (launch.screen === "solana") setSolanaAmount(launch.amount);
      return;
    }
    setPrivately(readDepositPrivately());
  }, [open, launch]);

  const setPrivate = (on: boolean) => {
    setPrivately(on);
    writeDepositPrivately(on);
  };

  const close = () => {
    setScreen("home");
    onClose();
  };

  const cluster = devnetMode ? "devnet" : "mainnet";
  const delay = DELAYS.find((d) => d.id === delayId) ?? DELAYS[0];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent
        wrapperZIndexClassName="z-[120]"
        className={cn(
          sora.variable,
          manrope.variable,
          "max-h-[min(92vh,880px)] w-[calc(100%-28px)] max-w-[440px] gap-0 overflow-y-auto rounded-[28px] border border-white/10 bg-[#141418] p-5 text-[#F2EFE8] shadow-2xl sm:rounded-[28px] [&>button.absolute]:hidden",
        )}
        style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}
      >
        <DialogTitle className="sr-only">Deposit</DialogTitle>
        <DialogDescription className="sr-only">Add USDC to your Loofta balance.</DialogDescription>
        <Header
          balanceUsd={balanceUsd}
          title={screen === "solana" ? "USDC on Solana" : screen === "address" ? "Send to an address" : screen === "card" || screen === "paj" ? "Card, bank or exchange" : null}
          privately={privately}
          showPrivacy={screen === "solana" || screen === "address"}
          onBack={screen === "home" ? null : () => setScreen(screen === "paj" ? "card" : "home")}
          onClose={close}
        />

        {screen === "home" && (
          <div className="mt-4 flex flex-col gap-3">
            <IncognitoModeToggle
              checked={privately}
              onCheckedChange={setPrivate}
              onLabel="Deposit privately"
              offLabel="Deposit privately"
              description={privately
                ? "On. Deposits are shielded, so they can't be linked to your Loofta account."
                : "Off. A deposit can be linked to your Loofta account."}
              ariaLabel="Deposit privately"
            />
            <p className="mt-2 text-sm font-semibold tracking-[0.14em] text-[#8A8893]">ADD FUNDS FROM</p>
            <MethodRow
              title="USDC on Solana"
              hint={privately ? "Connect a wallet. Private deposits can't be sent to an address." : "Scan the QR or connect a wallet"}
              badge="Fastest"
              onClick={() => setScreen("solana")}
              icons={[{ src: "/images/usdc.svg", bg: "#2775CA" }, { src: "/images/logo/solana-mark.svg", bg: "#111" }]}
            />
            <MethodRow
              title="Send to an address"
              hint="Solana, Base, Ethereum, BTC, ZEC, TON"
              onClick={() => setScreen("address")}
              icons={[
                { src: "/images/sol.png", bg: "#14F195" },
                { src: "/images/btc.svg", bg: "#F7931A" },
              ]}
            />
            <MethodRow
              title="Card or bank"
              hint="MoonPay, Coinbase, PAJ Cash, Revolut, Venmo, Cash App"
              onClick={() => setScreen("card")}
              icons={[
                { src: "/images/icons/moonpay-logo.svg", bg: "#1C1C22" },
                { src: "/images/icons/coinbase-logo.png", bg: "#0052FF" },
              ]}
            />
          </div>
        )}

        {screen === "solana" && solanaAddress && (
          <SolanaDeposit
            privately={privately}
            amount={solanaAmount}
            onAmount={setSolanaAmount}
            delayId={delayId}
            onDelay={setDelayId}
            split={split}
            onSplit={setSplit}
            delayMs={delay.ms}
            solanaAddress={solanaAddress}
            cluster={cluster}
            userId={user?.id}
            getAccessToken={getAccessToken}
            onRefresh={onRefresh}
            lockAmount={!!launch?.lockAmount && launch.screen === "solana"}
          />
        )}

        {screen === "address" && solanaAddress && (
          <AddressDeposit
            privately={privately}
            tokens={tokens}
            solanaAddress={solanaAddress}
            userId={user?.id}
            getAccessToken={getAccessToken}
            initialAmount={launch?.screen === "address" ? launch.amount : undefined}
            lockAmount={launch?.screen === "address" && launch.lockAmount}
          />
        )}

        {screen === "card" && solanaAddress && (
          <CardDeposit
            tokens={tokens}
            solanaAddress={solanaAddress}
            privately={privately}
            getAccessToken={getAccessToken}
            onPaj={() => setScreen("paj")}
            initialAmount={launch?.screen === "card" ? launch.amount : undefined}
            lockAmount={launch?.screen === "card" && launch.lockAmount}
            initialProvider={launch?.screen === "card" ? launch.card : undefined}
            receiveExactly={launch?.screen === "card" && launch.receiveExactly}
          />
        )}

        {screen === "paj" && (
          <PajCashOnrampView
            dark
            getAccessToken={getAccessToken}
            onBack={() => setScreen("card")}
            onComplete={onRefresh}
            prefillAmountUsd={launch?.screen === "paj" ? Number(launch.amount) : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Header({
  balanceUsd,
  title,
  privately,
  showPrivacy,
  onBack,
  onClose,
}: {
  balanceUsd: string;
  title: string | null;
  privately: boolean;
  showPrivacy: boolean;
  onBack: (() => void) | null;
  onClose: () => void;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[40px] font-bold leading-none tracking-tight text-white" style={{ fontFamily: SORA }}>
            ${balanceUsd}
          </p>
          <p className="mt-1.5 text-sm text-[#8A8893]">USDC available · Solana</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full bg-white/5 text-[#C8C6D0] hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      {(onBack || showPrivacy) && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {onBack ? (
            <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-[#C8C6D0] hover:text-white">
              <ChevronLeft className="h-4 w-4" />
              {title}
            </button>
          ) : <span />}
          {showPrivacy && (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold", privately ? "text-[#FF7A2A]" : "text-[#8A8893]")}>
              <Shield className="h-3.5 w-3.5" />
              {privately ? "Private" : "Not private"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MethodRow({
  title,
  hint,
  badge,
  icons,
  onClick,
}: {
  title: string;
  hint: string;
  badge?: string;
  icons: { src: string; bg: string }[];
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#1A1A20] px-3.5 py-3.5 text-left hover:border-white/20">
      <span className="flex shrink-0">
        {icons.map((icon, i) => (
          <span key={icon.src} className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl border-2 border-[#1A1A20]" style={{ background: icon.bg, marginLeft: i ? -10 : 0 }}>
            <img src={icon.src} alt="" className="h-5 w-5 object-contain" />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-base font-bold text-white" style={{ fontFamily: SORA }}>{title}</span>
          {badge && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-sm font-semibold text-emerald-400">{badge}</span>}
        </span>
        <span className="mt-0.5 block text-sm text-[#8A8893]">{hint}</span>
      </span>
      <span className="text-[#8A8893]">→</span>
    </button>
  );
}

function Pill({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
        active ? "border-[#FF7A2A] bg-[#FF7A2A]/15 text-white" : "border-white/10 bg-white/[0.04] text-[#C8C6D0] hover:bg-white/[0.08]",
      )}
    >
      {children}
    </button>
  );
}

function SolanaDeposit(props: {
  privately: boolean;
  amount: string;
  onAmount: (v: string) => void;
  delayId: string;
  onDelay: (id: (typeof DELAYS)[number]["id"]) => void;
  split: number;
  onSplit: (n: number) => void;
  delayMs: number;
  solanaAddress: string;
  cluster: "devnet" | "mainnet";
  userId?: string;
  getAccessToken: () => Promise<string | null>;
  onRefresh?: () => void;
  lockAmount?: boolean;
}) {
  const amountNum = Number(props.amount);
  const validAmount = Number.isFinite(amountNum) && amountNum >= 1;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const delayLabel = DELAYS.find((d) => d.id === props.delayId)?.label ?? "5 min";

  return (
    <div className="mt-4 flex flex-col gap-4">
      {props.privately && (
        <div className="rounded-2xl border border-white/10 bg-[#1A1A20]">
          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-white">Advanced settings</span>
              <span className="block text-sm text-[#8A8893]">
                {props.split > 1 ? `${props.split} parts · ${delayLabel}` : delayLabel}
              </span>
            </span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#8A8893] transition-transform", advancedOpen && "rotate-180")} />
          </button>
          {advancedOpen && (
            <div className="border-t border-white/10 px-4 py-3">
              <p className="text-sm font-semibold text-[#8A8893]">Release delay</p>
              <p className="text-sm text-[#8A8893]">Longer is harder to link</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DELAYS.map((d) => (
                  <Pill key={d.id} active={props.delayId === d.id} onClick={() => props.onDelay(d.id)}>{d.label}</Pill>
                ))}
              </div>
              <p className="mt-3 text-sm font-semibold text-[#8A8893]">Split into</p>
              <p className="text-sm text-[#8A8893]">Random amounts and times</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SPLITS.map((s) => (
                  <Pill key={s.n} active={props.split === s.n} onClick={() => props.onSplit(s.n)}>{s.label}</Pill>
                ))}
              </div>
              <p className="mt-3 text-sm text-[#C8C6D0]">
                {props.split > 1
                  ? `Arrives in ${props.split} payments, within about ${delayLabel}.`
                  : `Arrives in one payment, about ${delayLabel} after it's received.`}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-[#8A8893]">
                Privacy powered by <img src="/magicblock.svg" alt="MagicBlock" className="h-4 w-4" />
              </p>
            </div>
          )}
        </div>
      )}

      <label className="block">
        <span className="text-sm font-semibold text-[#C8C6D0]">Amount you&apos;ll receive (USDC)</span>
        <input
          inputMode="decimal"
          value={props.amount}
          readOnly={props.lockAmount}
          onChange={(e) => { if (!props.lockAmount) props.onAmount(e.target.value.replace(/[^0-9.]/g, "")); }}
          placeholder="20"
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0E0E12] px-3 py-3 text-base text-white outline-none focus:border-[#FF7A2A]/60"
        />
      </label>

      {!props.privately && (
        <>
          <div>
            <p className="text-base font-bold text-white">Deposit USDC on Solana</p>
            <p className="text-sm text-[#8A8893]">Only send USDC on the Solana network</p>
          </div>
          <AddressCard label="YOUR SOLANA ADDRESS" address={props.solanaAddress} />
        </>
      )}

      {props.privately && (
        <p className="text-sm text-[#8A8893]">Private USDC deposits are signed in your wallet. They can&apos;t be sent to an address.</p>
      )}

      <SolanaWalletConnectProvider rpcUrl={getRpcForMode(props.cluster)}>
        <ConnectWalletPay
          privately={props.privately}
          amount={validAmount ? amountNum : 0}
          destination={props.solanaAddress}
          cluster={props.cluster}
          userId={props.userId}
          split={props.split}
          delayMs={props.delayMs}
          getAccessToken={props.getAccessToken}
          onRefresh={props.onRefresh}
        />
      </SolanaWalletConnectProvider>
    </div>
  );
}

function AddressDeposit({
  privately,
  tokens,
  solanaAddress,
  userId,
  getAccessToken,
  initialAmount,
  lockAmount,
}: {
  privately: boolean;
  tokens: NearToken[];
  solanaAddress: string;
  userId?: string;
  getAccessToken: () => Promise<string | null>;
  initialAmount?: string;
  lockAmount?: boolean;
}) {
  const { toast } = useToast();
  const { wallets: evmWallets } = useEvmWallets();
  const evmAddress = evmWallets.find((w) => w.address?.startsWith("0x"))?.address ?? "";
  const [selection, setSelection] = useState<TokenSelection | undefined>(undefined);
  const [amount, setAmount] = useState(initialAmount ?? "");
  const [refund, setRefund] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [memo, setMemo] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridge, setBridge] = useState<string | null>(null);

  useEffect(() => {
    if (selection || tokens.length === 0) return;
    const sol = tokens.find((t) => t.symbol.toUpperCase() === "SOL" && isSolanaChain(t.chain));
    const first = sol ?? tokens[0];
    if (first) setSelection({ symbol: first.symbol, chain: first.chain });
  }, [selection, tokens]);

  const token = findTokenBySelection(tokens, selection);
  const usdc = findUsdcOnSolana(tokens);
  const alreadyUsdc = !!token && !!usdc && token.tokenId === usdc.tokenId;
  const amountNum = Number(amount);
  const refundValue = refund.trim() || (isEvmChain(token?.chain) ? evmAddress : isSolanaChain(token?.chain) ? solanaAddress : "");
  const refundOk = !!token && isValidAddressForChain(refundValue, token.chain);

  useEffect(() => {
    if (isEvmChain(token?.chain) && evmAddress && !refund) setRefund(evmAddress);
    if (isSolanaChain(token?.chain) && !refund) setRefund(solanaAddress);
  }, [token?.chain, evmAddress, solanaAddress, refund]);

  const quoteKey = `${privately}|${token?.tokenId}|${amount}|${refundValue}|${solanaAddress}`;

  useEffect(() => {
    setAddress(null);
    setMemo(null);
    setOut(null);
    setBridge(null);
    setError(null);
    if (!token || !usdc || alreadyUsdc || !userId || !(amountNum > 0) || !refundOk) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const info = await requestConfidentialQuote({
          privately,
          from: token,
          to: usdc,
          amount: String(amountNum),
          recipient: solanaAddress,
          refundAddress: refundValue,
        });
        if (cancelled) return;
        if (!info.depositAddress) throw new Error("No deposit address returned");
        setAddress(info.depositAddress);
        setMemo(info.memo ?? null);
        const rawOut = info.raw?.quote?.amountOutFormatted ?? info.raw?.amountOutFormatted;
        setOut(typeof rawOut === "string" ? rawOut : null);
        setBridge("PENDING");
        const access = await getAccessToken();
        if (access) {
          await fetch("/api/users/deposits", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
            body: JSON.stringify({ type: "near-intents", status: "pending", deposit_address: info.depositAddress }),
          }).catch(() => {});
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't get a deposit address");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  useEffect(() => {
    if (!address || (bridge && TERMINAL.has(bridge))) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await getExecutionStatus(address);
        const s = String(result?.status || result?.executionStatus || "PENDING").toUpperCase();
        if (!cancelled) setBridge(s);
      } catch { /* retry */ }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [address, bridge]);

  const chainLabel = token ? formatChainLabel(token.chain).toUpperCase() : "SOURCE";

  return (
    <div className="mt-4 flex flex-col gap-4">
      {privately && (
        <div className="flex items-center gap-3 rounded-2xl border border-[#FF7A2A]/25 bg-[#2A160F] px-3.5 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-black text-white">
            <img src="/images/icons/near-logo.png" alt="" className="h-5 w-5 object-contain" />
          </span>
          <span>
            <span className="block text-sm font-bold text-white">NEAR Confidential Intents</span>
            <span className="block text-sm text-[#C8C6D0]">Private deposit from any chain</span>
          </span>
        </div>
      )}

      <label className="block">
        <span className="text-sm text-[#8A8893]">Token</span>
        <div className="mt-1">
          <TokenCombobox
            tokens={tokens}
            value={selection}
            defaultShowAllChains
            placeholder="Search a token"
            onChange={(next) => { setSelection(next); setRefund(""); }}
          />
        </div>
      </label>

      {alreadyUsdc && (
        <p className="text-sm text-[#C8C6D0]">
          USDC on Solana is already the balance asset. Use USDC on Solana to deposit it directly. This screen swaps other tokens into USDC.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-sm text-[#8A8893]">Amount ({token?.symbol ?? "—"})</span>
          <input
            inputMode="decimal"
            value={amount}
            readOnly={lockAmount}
            onChange={(e) => { if (!lockAmount) setAmount(e.target.value.replace(/[^0-9.]/g, "")); }}
            placeholder="0"
            disabled={alreadyUsdc}
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#0E0E12] px-3 py-2.5 text-base text-white outline-none focus:border-[#FF7A2A]/60 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-sm text-[#8A8893]">Refund address</span>
          <input
            value={refund}
            onChange={(e) => setRefund(e.target.value)}
            placeholder={token ? `Your ${token.chain} address` : "Refund address"}
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#0E0E12] px-3 py-2.5 text-sm text-white outline-none focus:border-[#FF7A2A]/60"
          />
        </label>
      </div>
      {refundValue && token && !refundOk && <p className="text-sm text-red-400">That refund address doesn&apos;t match {token.chain}.</p>}

      {!alreadyUsdc && (
      <AddressCard
        label={`ONE-TIME ${chainLabel} ADDRESS`}
        address={address}
        loading={loading}
        empty={!(amountNum > 0) ? "Enter an amount to generate a one-time address." : !refundOk ? "Add a refund address on the source chain." : error ?? undefined}
      />
      )}
      {memo && (
        <CopyLine label="Memo — required" value={memo} onCopy={() => toast({ title: "Memo copied" })} />
      )}

      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <span className="text-[#8A8893]">Send</span>
        <span className="text-right font-semibold text-white">{token ? `${token.symbol} on ${formatChainLabel(token.chain)}` : "—"}</span>
        <span className="text-[#8A8893]">Arrives</span>
        <span className="text-right font-semibold text-white">{alreadyUsdc ? "Already USDC" : out ? `~${out} USDC on Solana` : "Swapped to USDC on Solana"}</span>
        <span className="text-[#8A8893]">Privacy</span>
        <span className="text-right font-semibold text-white">{privately ? "Confidential Intents" : "Public swap"}</span>
      </div>

      <Waiting bridge={bridge} />
    </div>
  );
}

async function requestConfidentialQuote(args: {
  privately: boolean;
  from: NearToken;
  to: NearToken;
  amount: string;
  recipient: string;
  refundAddress: string;
}) {
  const base = {
    fromToken: args.from,
    toToken: args.to,
    amount: args.amount,
    recipient: args.recipient,
    sender: args.refundAddress,
    refundAddress: args.refundAddress,
    slippageBps: 100,
  };
  if (!args.privately) return getDepositInfo({ ...base, confidentiality: "public" });
  try {
    return await getDepositInfo({ ...base, confidentiality: "advanced" });
  } catch {
    return getDepositInfo({ ...base, confidentiality: "basic" });
  }
}

function CardDeposit({
  tokens,
  solanaAddress,
  privately,
  getAccessToken,
  onPaj,
  initialAmount,
  lockAmount,
  initialProvider,
  receiveExactly,
}: {
  tokens: NearToken[];
  solanaAddress: string;
  privately: boolean;
  getAccessToken: () => Promise<string | null>;
  onPaj: () => void;
  initialAmount?: string;
  lockAmount?: boolean;
  initialProvider?: CardProvider;
  receiveExactly?: boolean;
}) {
  const { toast } = useToast();
  const { createWallet: createEvmWallet } = useCreateWallet();
  const { wallets: evmWallets } = useEvmWallets();
  const [provider, setProvider] = useState<CardProvider>(initialProvider ?? "moonpay");
  const [amount, setAmount] = useState(initialAmount ?? "50");
  const [busy, setBusy] = useState(false);
  const amountNum = Number(amount);
  const providers = CARD_PROVIDERS.filter((p) => p.id !== "paj" || PAJ_CASH_ENABLED);
  const selected = providers.find((p) => p.id === provider) ?? providers[0];

  const continueWith = async () => {
    if (!(amountNum > 0)) return;
    if (provider === "paj") { onPaj(); return; }
    setBusy(true);
    try {
      if (provider === "moonpay") {
        const key = process.env.NEXT_PUBLIC_MOONPAY_API_KEY;
        const url = new URL("https://buy.moonpay.com");
        if (key) url.searchParams.set("apiKey", key);
        url.searchParams.set("currencyCode", "usdc_sol");
        url.searchParams.set("walletAddress", solanaAddress);
        url.searchParams.set("baseCurrencyCode", "usd");
        url.searchParams.set(receiveExactly ? "quoteCurrencyAmount" : "baseCurrencyAmount", String(amountNum));
        window.open(url.toString(), "moonpay", "width=460,height=730");
        if (!key) toast({ title: "MoonPay opened", description: "If the window asks for an API key, set NEXT_PUBLIC_MOONPAY_API_KEY." });
        return;
      }
      if (provider === "coinbase") {
        const access = await getAccessToken();
        const sessionRes = await fetch("/api/coinbase/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
          body: JSON.stringify({ walletAddress: solanaAddress, blockchains: ["solana"] }),
        });
        if (!sessionRes.ok) {
          const err = await sessionRes.json().catch(() => ({})) as { error?: string; detail?: string };
          throw new Error(err.detail || err.error || "Could not start Coinbase");
        }
        const sessionData = await sessionRes.json();
        if (!sessionData.token) throw new Error("No Coinbase session token");
        const params = new URLSearchParams({
          appId: "68e3c83a-3d5a-49aa-a8fa-7ef26d824de1",
          defaultNetwork: "solana",
          defaultAsset: "USDC",
          addresses: JSON.stringify({ [solanaAddress]: ["solana"] }),
          assets: JSON.stringify(["USDC"]),
          sessionToken: sessionData.token,
        });
        window.open(`https://pay.coinbase.com/buy/select-asset?${params.toString()}`, "coinbase-onramp", "width=460,height=730");
        return;
      }
      await startPeerCheckout({
        amount: String(amountNum),
        solanaAddress,
        tokens,
        evmWallets,
        createEvmWallet,
        getAccessToken,
        privately,
      });
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't start that deposit", description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {providers.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setProvider(item.id)}
            className={cn(
              "rounded-2xl border bg-[#1A1A20] p-3 text-left",
              provider === item.id ? "border-[#FF7A2A]" : "border-white/10 hover:border-white/20",
            )}
          >
            <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-white/5">
              <img src={item.logo} alt="" className="h-7 w-7 object-contain" />
            </span>
            <span className="mt-3 block text-sm font-bold text-white">{item.name}</span>
            <span className="mt-0.5 block text-sm leading-snug text-[#8A8893]">{item.hint}</span>
          </button>
        ))}
      </div>
      <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#1A1A20] px-4 py-3">
        <span className="text-sm font-semibold text-[#8A8893]">{receiveExactly ? "USDC to receive" : "USD"}</span>
        <input
          inputMode="decimal"
          value={amount}
          readOnly={lockAmount}
          onChange={(e) => { if (!lockAmount) setAmount(e.target.value.replace(/[^0-9.]/g, "")); }}
          className="w-28 bg-transparent text-right text-3xl font-bold text-white outline-none"
          style={{ fontFamily: SORA }}
        />
      </label>
      <p className="text-sm text-[#8A8893]">
        {selected.name} sends USDC to your Loofta balance{privately ? ". Cross-chain card deposits still settle through a quote, then land as USDC." : "."}
      </p>
      <button
        type="button"
        disabled={busy || !(amountNum > 0)}
        onClick={() => void continueWith()}
        className="rounded-2xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-4 text-base font-bold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Opening…" : `Continue with ${selected.name}`}
      </button>
    </div>
  );
}

async function startPeerCheckout(args: {
  amount: string;
  solanaAddress: string;
  tokens: NearToken[];
  evmWallets: { address: string; walletClientType?: string; getEthereumProvider?: () => unknown }[];
  createEvmWallet: () => Promise<unknown>;
  getAccessToken: () => Promise<string | null>;
  privately: boolean;
}) {
  const base = findUsdcOnBase(args.tokens);
  const sol = findUsdcOnSolana(args.tokens);
  if (!base || !sol) throw new Error("USDC on Base isn't available for this deposit yet.");
  const find = () => args.evmWallets.find((w) => w.walletClientType === "privy" && w.address?.startsWith("0x"));
  let wallet = find();
  if (!wallet) {
    try { await args.createEvmWallet(); } catch (e) {
      if (!String((e as Error)?.message).toLowerCase().includes("already has")) throw e;
    }
    for (let i = 0; i < 20 && !wallet; i++) {
      await new Promise((r) => setTimeout(r, 300));
      wallet = find();
    }
  }
  if (!wallet) throw new Error("Could not load a Base wallet for the refund address.");
  const info = await getDepositInfo({
    fromToken: base,
    toToken: sol,
    amount: args.amount,
    recipient: args.solanaAddress,
    sender: wallet.address,
    refundAddress: wallet.address,
    confidentiality: args.privately ? "advanced" : "public",
  });
  if (!info.depositAddress) throw new Error("Could not get a deposit address");
  const access = await args.getAccessToken();
  const res = await fetch("/api/peer-pay/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    body: JSON.stringify({ amountUsdc: Number(args.amount), destinationAddress: info.depositAddress }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || "Could not open checkout");
  }
  const { checkoutUrl } = await res.json();
  window.open(checkoutUrl, "peer-checkout", "width=460,height=730");
}

function ConnectWalletPay(props: {
  privately: boolean;
  amount: number;
  destination: string;
  cluster: "devnet" | "mainnet";
  userId?: string;
  split: number;
  delayMs: number;
  getAccessToken: () => Promise<string | null>;
  onRefresh?: () => void;
}) {
  const { publicKey, signTransaction, connected, connecting, disconnect } = useWallet();
  const { toast } = useToast();
  const [paying, setPaying] = useState(false);
  const short = publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : "";

  const pay = async () => {
    if (!publicKey || !signTransaction || props.amount < 1 || !props.userId) {
      toast({ title: "Enter at least 1 USDC", description: "Then connect a wallet to pay." });
      return;
    }
    const from = publicKey.toBase58();
    if (!props.privately && from === props.destination) {
      toast({ title: "Use a different wallet", description: "This address is already your Loofta balance." });
      return;
    }
    setPaying(true);
    try {
      const connection = new Connection(getRpcForMode(props.cluster), "confirmed");
      if (props.privately) {
        const access = await props.getAccessToken();
        const txData = await buildDirectPrivateDeposit(props.amount, from, props.userId, access, props.cluster, {
          split: props.split,
          maxDelayMs: props.delayMs,
        });
        const raw = Buffer.from(txData.transactionBase64, "base64");
        let tx: Transaction | VersionedTransaction;
        try { tx = Transaction.from(raw); } catch { tx = VersionedTransaction.deserialize(raw); }
        const signed = await (signTransaction as (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>)(tx);
        const broadcast = txData.sendTo === "ephemeral"
          ? new Connection(getEphemeralRpcForMode(props.cluster), "confirmed")
          : connection;
        const serialized = signed instanceof Transaction ? signed.serialize() : signed.serialize();
        const signature = await broadcast.sendRawTransaction(serialized, { skipPreflight: false, preflightCommitment: "confirmed" });
        await waitForSignatureConfirmation(broadcast, signature, 120_000, 1500, "depositWallet");
      } else {
        const tx = await buildUSDCTransferTransaction({
          senderAddress: from,
          recipientAddress: props.destination,
          amountUSDC: props.amount,
          connection,
          usdcMint: getUsdcMintForMode(props.cluster),
        });
        const signed = await (signTransaction as (tx: VersionedTransaction) => Promise<VersionedTransaction>)(tx);
        const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
        await waitForSignatureConfirmation(connection, signature, 120_000, 1500, "depositWalletPublic");
      }
      props.onRefresh?.();
      toast({
        title: "Sent",
        description: props.privately ? "Routing privately to your balance." : "USDC is on its way to your balance.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Payment failed";
      if (!/reject|cancel|denied/i.test(msg)) toast({ variant: "destructive", title: "Payment failed", description: msg });
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <style>{`.wallet-adapter-modal-wrapper,.wallet-adapter-modal{z-index:10000 !important}`}</style>
      {!props.privately && (
        <p className="text-center text-sm font-semibold tracking-[0.14em] text-[#8A8893]">OR CONNECT A WALLET</p>
      )}
      {connected && publicKey ? (
        <>
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#1A1A20] px-3.5 py-3">
            <span className="font-mono text-sm text-white">{short}</span>
            <button type="button" onClick={() => void disconnect()} disabled={paying} className="text-sm text-[#8A8893] hover:text-white disabled:opacity-50">
              Disconnect
            </button>
          </div>
          <button
            type="button"
            onClick={() => void pay()}
            disabled={paying || props.amount < 1}
            className="rounded-2xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-3.5 text-base font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {paying ? "Confirm in your wallet…" : props.privately ? `Pay $${totalWithMagicBlockPrivateFee(props.amount).toFixed(2)} privately` : `Pay $${props.amount.toFixed(2)} USDC`}
          </button>
        </>
      ) : (
        <div className="[&_.wallet-adapter-button]:flex [&_.wallet-adapter-button]:h-12 [&_.wallet-adapter-button]:w-full [&_.wallet-adapter-button]:items-center [&_.wallet-adapter-button]:justify-center [&_.wallet-adapter-button]:rounded-2xl [&_.wallet-adapter-button]:text-base [&_.wallet-adapter-button]:font-bold [&_.wallet-adapter-dropdown]:block [&_.wallet-adapter-dropdown]:w-full">
          <WalletMultiButton style={{ background: "linear-gradient(90deg,#FF1301,#EAB308)", width: "100%" }}>
            {connecting ? "Connecting…" : "Connect wallet"}
          </WalletMultiButton>
        </div>
      )}
    </div>
  );
}

function AddressCard({
  label,
  address,
  loading,
  empty,
}: {
  label: string;
  address?: string | null;
  loading?: boolean;
  empty?: string;
}) {
  const { toast } = useToast();
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0E0E12] p-4">
      {loading && (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-[#C8C6D0]"><Loader2 className="h-4 w-4 animate-spin" /> Getting a one-time address…</p>
      )}
      {!loading && address && (
        <div className="flex items-center gap-4">
          <div className="shrink-0 rounded-xl bg-white p-2">
            <QRCodeSVG value={address} size={112} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-[0.08em] text-[#8A8893]">{label}</p>
            <p className="mt-1 break-all font-mono text-sm text-white">{address}</p>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(address); toast({ title: "Address copied" }); }}
              className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/15"
            >
              <Copy className="mr-1 inline h-3.5 w-3.5" /> Copy address
            </button>
          </div>
        </div>
      )}
      {!loading && !address && <p className="py-6 text-center text-sm text-[#8A8893]">{empty ?? "Address will show here."}</p>}
    </div>
  );
}

function CopyLine({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2">
      <p className="text-sm font-semibold text-amber-300">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="min-w-0 flex-1 break-all font-mono text-sm text-white">{value}</p>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(value); onCopy(); }} className="text-[#C8C6D0] hover:text-white"><Copy className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Waiting({ status, bridge }: { status?: PrivateTransferStatus | null; bridge?: string | null }) {
  const label = status === "complete" || (bridge && SUCCESS.has(bridge))
    ? "Deposit received"
    : status === "failed" || bridge === "FAILED" || bridge === "REFUNDED" || bridge === "EXPIRED"
      ? "Deposit didn't complete"
      : status === "delivering_privately" || bridge === "PENDING" || status === "awaiting_funds"
        ? "Waiting for your deposit…"
        : null;
  if (!label) return null;
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#1A1A20] py-3.5 text-sm font-semibold text-white">
      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
      {label}
    </div>
  );
}

function isEvmChain(chain?: string) {
  return !!chain && ["eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism", "pol", "polygon", "matic", "monad", "bsc", "avax", "avalanche", "scroll", "linea"].includes(chain.toLowerCase());
}

function isSolanaChain(chain?: string) {
  return chain === "sol" || chain === "solana";
}
