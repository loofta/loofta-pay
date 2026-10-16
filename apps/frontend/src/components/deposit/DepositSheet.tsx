"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useCreateWallet, usePrivy, useWallets as useEvmWallets } from "@privy-io/react-auth";
import { useSignTransaction, useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { ChevronDown, ChevronLeft, Copy, ExternalLink, Loader2, Shield, X } from "lucide-react";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { SolanaWalletConnectProvider, useWallet, WalletMultiButton } from "@/components/SolanaWalletConnect";
import { PajCashOnrampView } from "@/components/paj-cash/PajCashOnrampView";
import { PajCashOfframpView } from "@/components/paj-cash/PajCashOfframpView";
import { PEER_PLATFORMS } from "@/lib/peerPlatforms";
import { usePerPrivateSelfTransfer } from "@/hooks/usePerPrivateSelfTransfer";
import { useSolDomain } from "@/hooks/useSolDomain";
import { useSolPriceOrNull } from "@/hooks/useSolPrice";
import { privyStandardWalletToAnchorWallet } from "@/lib/per/signer";
import { prepareNearIntentsWithdrawal } from "@/services/solanaSponsor";
import { sendUsdcWithBackendFeePayer } from "@/services/privyEmbeddedUsdcSend";
import { addWithdrawal } from "@/lib/withdrawalHistory";
import { sora, manrope } from "@/components/home-v4/fonts";
import { getAccurateQuote, getDepositInfo, getExecutionStatus, type NearToken } from "@/services/nearIntents";
import { buildDirectPrivateDeposit, type PrivateTransferStatus } from "@/services/api/privateBalance";
import { buildUSDCTransferTransaction } from "@/services/solanaTransfer";
import { getEphemeralRpcForMode } from "@/lib/per/constants";
import { getPrivySolanaChainForMode, getRpcForMode, getUsdcMintForMode } from "@/lib/solanaRpc";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { isValidAddressForChain } from "@/lib/refundAddresses";
import { cn } from "@/lib/utils";
import { ChanceUpsellCard } from "@/components/ChanceUpsellCard";
import { CHANCE_PRICE_USDC, CHANCE_MIN_BALANCE_USDC, useChanceTicket } from "@/hooks/useChanceTicket";
import { findUsdcOnBase, findUsdcOnSolana, readDepositPrivately, writeDepositPrivately } from "@/lib/depositRails";
import { totalWithMagicBlockPrivateFee } from "@/services/magicblockPrivateTransfer";
import { TokenCombobox } from "@/components/TokenCombobox";
import { findTokenBySelection, formatChainLabel } from "@/lib/tokens";
import type { TokenSelection } from "@/app/utils/types";
import type { Deposit as BlinkDeposit } from "@swype-org/deposit";

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

export type CashOutRequest = { platformId: string; identifier: string; amountUsd: number; intent?: "pay" | "receive" };

/** MagicBlock exactOut private withdrawals debit amount + fees ON TOP of the typed amount.
 *  Reserve this headroom on Max / validation so Max never builds an on-chain overdraft.
 *  Mirrors BalanceModal's PRIVATE_WITHDRAW_FEE_HEADROOM_USDC. */
const PRIVATE_WITHDRAW_FEE_HEADROOM_USDC = 0.3;

export function DepositSheet({
  open,
  onClose,
  balanceUsd,
  balanceExact,
  solanaAddress,
  devnetMode,
  onRefresh,
  launch,
  showModeSwitch = false,
  initialMode = "deposit",
  initialScreen = "home",
  onCashOut,
}: {
  open: boolean;
  onClose: () => void;
  balanceUsd: string;
  /** Unrounded chain balance. Prefer this for withdraw Max/validation — balanceUsd is display-only (2dp). */
  balanceExact?: number;
  solanaAddress: string | null;
  devnetMode: boolean;
  onRefresh?: () => void;
  launch?: DepositLaunch | null;
  /** Balance sheet can switch between adding funds and sending them out. */
  showModeSwitch?: boolean;
  initialMode?: "deposit" | "withdraw";
  initialScreen?: Screen;
  /** Bank-app cash-out continues in the existing Peer flow. */
  onCashOut?: (pay: CashOutRequest) => void;
}) {
  const { toast } = useToast();
  const { user, getAccessToken } = usePrivy();
  const { data: tokens = [] } = useTokensQuery();
  const [screen, setScreen] = useState<Screen>("home");
  const [mode, setMode] = useState<"deposit" | "withdraw">(initialMode);
  const [privately, setPrivately] = useState(true);
  // Floor to micro-USDC so Max never asks for more than the token account can spend.
  // balanceUsd alone is toFixed(2) and can round UP (e.g. 10.006 → "10.01"), which then
  // fails Token Program 0x1 / insufficient funds on simulation.
  const balanceNum = Math.floor((balanceExact ?? (Number(balanceUsd) || 0)) * 1_000_000) / 1_000_000;
  const [solanaAmount, setSolanaAmount] = useState("");
  const [delayId, setDelayId] = useState<(typeof DELAYS)[number]["id"]>("5m");
  const [split, setSplit] = useState<number>(1);
  const [blinkDepositing, setBlinkDepositing] = useState(false);
  const [blinkError, setBlinkError] = useState<string | null>(null);
  const blinkDepositRef = useRef<BlinkDeposit | null>(null);

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

  useEffect(() => {
    if (!open || launch) return;
    setMode(initialMode);
    if (initialMode === "withdraw" && initialScreen !== "home") setScreen(initialScreen);
  }, [open, launch, initialMode, initialScreen]);

  useEffect(() => {
    if (open) return;
    setBlinkError(null);
    blinkDepositRef.current?.destroy();
    blinkDepositRef.current = null;
    setBlinkDepositing(false);
  }, [open]);

  const setPrivate = (on: boolean) => {
    setPrivately(on);
    writeDepositPrivately(on);
  };

  const handleBlinkDeposit = async () => {
    if (!solanaAddress || blinkDepositing) return;
    setBlinkDepositing(true);
    setBlinkError(null);
    try {
      blinkDepositRef.current?.destroy();
      const { Deposit } = await import("@swype-org/deposit");
      blinkDepositRef.current = new Deposit({
        signer: async (data: unknown) => {
          const token = await getAccessToken();
          const res = await fetch("/api/blink/sign", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(data),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(err.error ?? "Signer request failed");
          }
          return res.json();
        },
        debug: true,
        containerElement: document.body,
      });
      const depositResult = await blinkDepositRef.current.requestDeposit({
        amount: null,
        chainId: 792703809,
        address: solanaAddress,
        token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      });
      toast({ title: "Deposit complete!", description: "USDC will appear in your balance shortly." });
      const depositedAmount = depositResult?.transfer?.amount?.amount;
      try {
        const token = await getAccessToken();
        if (token) {
          await fetch("/api/users/deposits", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ type: "blink", status: "complete", amount_usdc: depositedAmount }),
          });
        }
      } catch { /* non-fatal */ }
      onRefresh?.();
      close();
    } catch (err: unknown) {
      const { DepositError, getDisplayMessage } = await import("@swype-org/deposit");
      setBlinkError(err instanceof DepositError ? getDisplayMessage(err) : "Deposit failed. Please try again.");
    } finally {
      blinkDepositRef.current?.destroy();
      blinkDepositRef.current = null;
      setBlinkDepositing(false);
    }
  };

  const close = () => {
    setScreen("home");
    onClose();
  };

  const cluster = devnetMode ? "devnet" : "mainnet";
  const delay = DELAYS.find((d) => d.id === delayId) ?? DELAYS[0];

  return (
    // modal={false} (same as BalanceModal "fix modal blink"): Blink mounts on document.body
    // above this sheet. Radix modal dismiss/focus-trap treats those clicks as outside and would
    // close the sheet / steal focus from Blink's iframe and passkeys.
    // Unmount DialogContent while Blink is open — the sheet's overflow-y-auto portal still
    // intercepts wheel/touch scroll even under Blink's max z-index iframe.
    <Dialog
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next && !blinkDepositing) close();
      }}
    >
      {open && !blinkDepositing ? (
      <DialogContent
        wrapperZIndexClassName="z-[120]"
        className={cn(
          sora.variable,
          manrope.variable,
          "max-h-[min(92vh,880px)] w-[calc(100%-28px)] max-w-[440px] gap-0 overflow-y-auto rounded-[28px] border border-white/10 bg-[#141418] p-5 text-[#F2EFE8] shadow-2xl sm:rounded-[28px] [&>button.absolute]:hidden",
        )}
        style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}
      >
        <DialogTitle className="sr-only">{mode === "withdraw" ? "Withdraw" : "Deposit"}</DialogTitle>
        <DialogDescription className="sr-only">
          {mode === "withdraw" ? "Send USDC from your Loofta balance." : "Add USDC to your Loofta balance."}
        </DialogDescription>
        <Header
          balanceUsd={balanceUsd}
          title={screen === "solana" ? "USDC on Solana" : screen === "address" ? (mode === "withdraw" ? "Any crypto" : "Send to an address") : screen === "card" || screen === "paj" ? (mode === "withdraw" ? "Bank app" : "Card") : null}
          privately={privately}
          showPrivacy={screen === "solana" || screen === "address"}
          onBack={screen === "home" ? null : () => setScreen(screen === "paj" ? "card" : "home")}
          onClose={close}
        />

        {screen === "home" && (
          <div className="mt-4 flex flex-col gap-3">
            {showModeSwitch && (
              <div className="grid grid-cols-2 rounded-full bg-[#0E0E12] p-1">
                {(["deposit", "withdraw"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { setMode(id); setScreen("home"); }}
                    className={cn(
                      "rounded-full py-2 text-sm font-semibold",
                      mode === id ? "bg-[#2A2A32] text-white" : "text-[#8A8893] hover:text-white",
                    )}
                  >
                    {id === "deposit" ? "Deposit" : "Withdraw"}
                  </button>
                ))}
              </div>
            )}
            {mode === "withdraw" && (
              <IncognitoModeToggle
                checked={privately}
                onCheckedChange={setPrivate}
                onLabel="Withdraw privately"
                offLabel="Withdraw privately"
                description={privately
                  ? "On. Solana and crypto withdrawals are shielded, so they can't be linked to your Loofta account."
                  : "Off. A withdrawal can be linked to your Loofta account."}
                ariaLabel="Withdraw privately"
              />
            )}
            <p className="mt-2 text-sm font-semibold tracking-[0.14em] text-[#8A8893]">{mode === "withdraw" ? "SEND FUNDS TO" : "ADD FUNDS FROM"}</p>
            {mode === "withdraw" ? (
              <>
                <MethodRow
                  title="USDC on Solana"
                  hint={privately ? "To any Solana wallet, privately" : "To any Solana wallet"}
                  badge="Fastest"
                  onClick={() => setScreen("solana")}
                  icons={[{ src: "/images/usdc.svg", bg: "#2775CA" }, { src: "/images/logo/solana-mark.svg", bg: "#111" }]}
                />
                <MethodRow
                  title="Any crypto"
                  hint="BTC, ETH, ZEC, and other chains"
                  onClick={() => setScreen("address")}
                  icons={[
                    { src: "/images/btc.svg", bg: "#F7931A" },
                    { src: "/images/eth.svg", bg: "#627EEA" },
                  ]}
                />
                <MethodRow
                  title="Bank app"
                  hint={privately ? "Coinbase, Revolut, Venmo, Cash App. Not private." : "Coinbase, PAJ Cash, Revolut, Venmo, Cash App"}
                  onClick={() => setScreen("card")}
                  icons={[
                    { src: "/images/platforms/revolut.png", bg: "#1C1C22" },
                    { src: "/images/platforms/venmo.png", bg: "#008CFF" },
                  ]}
                />
              </>
            ) : null}
            {mode === "deposit" && (
            <>
            <MethodRow
              title="Crypto deposit"
              hint="USDC · USDT · SOL · ETH · BNB"
              onClick={() => { void handleBlinkDeposit(); }}
              disabled={!solanaAddress || blinkDepositing}
              busy={blinkDepositing}
              icons={[{ src: "/images/blink/icon-yellow.png", bg: "#1C1C22" }]}
            />
            <MethodRow
              title="Card"
              hint="MoonPay, Coinbase, PAJ Cash, Revolut, Venmo, Cash App"
              onClick={() => setScreen("card")}
              disabled={blinkDepositing}
              icons={[
                { src: "/images/icons/moonpay-logo.svg", bg: "#1C1C22" },
                { src: "/images/icons/coinbase-logo.png", bg: "#0052FF" },
              ]}
            />
            {blinkError && <p className="text-sm text-orange-500 text-center px-1">{blinkError}</p>}
            </>
            )}
          </div>
        )}

        {mode === "deposit" && screen === "solana" && solanaAddress && (
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

        {mode === "deposit" && screen === "address" && solanaAddress && (
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

        {mode === "deposit" && screen === "card" && solanaAddress && (
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

        {mode === "deposit" && screen === "paj" && (
          <PajCashOnrampView
            dark
            getAccessToken={getAccessToken}
            onBack={() => setScreen("card")}
            onComplete={onRefresh}
            prefillAmountUsd={launch?.screen === "paj" ? Number(launch.amount) : undefined}
          />
        )}

        {mode === "withdraw" && screen === "solana" && solanaAddress && (
          <SolanaWithdraw
            privately={privately}
            balanceNum={balanceNum}
            solanaAddress={solanaAddress}
            devnetMode={devnetMode}
            userId={user?.id}
            getAccessToken={getAccessToken}
            onRefresh={onRefresh}
          />
        )}

        {mode === "withdraw" && screen === "address" && solanaAddress && (
          <CryptoWithdraw
            privately={privately}
            balanceNum={balanceNum}
            tokens={tokens}
            solanaAddress={solanaAddress}
            devnetMode={devnetMode}
            userId={user?.id}
            getAccessToken={getAccessToken}
            onRefresh={onRefresh}
          />
        )}

        {mode === "withdraw" && screen === "card" && (
          <BankWithdraw
            devnetMode={devnetMode}
            solanaAddress={solanaAddress}
            balanceNum={balanceNum}
            getAccessToken={getAccessToken}
            onPaj={() => setScreen("paj")}
            onCashOut={onCashOut}
          />
        )}

        {mode === "withdraw" && screen === "paj" && (
          <PajWithdraw
            devnetMode={devnetMode}
            solanaAddress={solanaAddress}
            balanceNum={balanceNum}
            userId={user?.id}
            getAccessToken={getAccessToken}
            onBack={() => setScreen("card")}
            onRefresh={onRefresh}
          />
        )}
      </DialogContent>
      ) : null}
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
  disabled,
  busy,
}: {
  title: string;
  hint: string;
  badge?: string;
  icons: { src: string; bg: string }[];
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#1A1A20] px-3.5 py-3.5 text-left hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className="flex shrink-0">
        {busy ? (
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#1C1C22]">
            <Loader2 className="h-5 w-5 animate-spin text-orange-400" />
          </span>
        ) : (
          icons.map((icon, i) => (
            <span key={icon.src} className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl border-2 border-[#1A1A20]" style={{ background: icon.bg, marginLeft: i ? -10 : 0 }}>
              <img src={icon.src} alt="" className="h-5 w-5 object-contain" />
            </span>
          ))
        )}
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

const ATA_RENT_SOL = 0.00203928;
const ATA_FEE_BUFFER = 1.25;
const ATA_SETUP_FEE_FALLBACK_USDC = 0.2;

function useLooftaSigner(solanaAddress: string | null) {
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const wallet = useMemo(() => {
    const list = wallets ?? [];
    const match = solanaAddress ? list.find((w) => w.address === solanaAddress) : undefined;
    return match ?? list.find((w) => (w as { walletClientType?: string }).walletClientType === "privy") ?? list[0];
  }, [wallets, solanaAddress]);
  return { wallet, signTransaction };
}

function useAtaSetupFee() {
  const solPriceUsd = useSolPriceOrNull();
  return solPriceUsd ? Math.ceil(ATA_RENT_SOL * ATA_FEE_BUFFER * solPriceUsd * 100) / 100 : ATA_SETUP_FEE_FALLBACK_USDC;
}

async function saveWithdrawal(item: Parameters<typeof addWithdrawal>[0], access: string | null, devnet: boolean) {
  addWithdrawal(item);
  if (!access) return;
  await fetch("/api/withdrawals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
    body: JSON.stringify({ ...item, isDevnet: devnet }),
  }).catch(() => {});
}

async function addressIsSafe(address: string) {
  const res = await fetch(`/api/risk/address?address=${encodeURIComponent(address)}&network=solana`);
  const data = await res.json().catch(() => ({}));
  return (data as { safe?: boolean }).safe !== false;
}

function AmountField({
  label,
  value,
  onChange,
  onMax,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onMax?: () => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[#C8C6D0]">{label}</span>
      <span className="mt-1.5 flex gap-2">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
          className="w-full rounded-xl border border-white/10 bg-[#0E0E12] px-3 py-3 text-base text-white outline-none focus:border-[#FF7A2A]/60"
        />
        {onMax && (
          <button type="button" onClick={onMax} className="shrink-0 rounded-xl border border-white/10 px-3 text-sm font-semibold text-[#C8C6D0] hover:bg-white/[0.06]">
            Max
          </button>
        )}
      </span>
    </label>
  );
}

function SendButton({ busy, disabled, label, busyLabel, onClick }: { busy: boolean; disabled: boolean; label: string; busyLabel: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className="w-full rounded-2xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-3.5 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
    >
      {busy ? <span className="inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{busyLabel}</span> : label}
    </button>
  );
}

function SolanaWithdraw({
  privately,
  balanceNum,
  solanaAddress,
  devnetMode,
  userId,
  getAccessToken,
  onRefresh,
}: {
  privately: boolean;
  balanceNum: number;
  solanaAddress: string;
  devnetMode: boolean;
  userId?: string;
  getAccessToken: () => Promise<string | null>;
  onRefresh?: () => void;
}) {
  const { toast } = useToast();
  const { withdraw: withdrawPrivately } = usePerPrivateSelfTransfer();
  const { wallet, signTransaction } = useLooftaSigner(solanaAddress);
  const ataFee = useAtaSetupFee();
  const cluster = devnetMode ? "devnet" : "mainnet";
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [risk, setRisk] = useState<"idle" | "checking" | "safe" | "unsafe">("idle");
  const [needsAccount, setNeedsAccount] = useState(false);
  const [confirmFee, setConfirmFee] = useState<number | null>(null);
  const [privateFee, setPrivateFee] = useState<number | null>(null);
  const confirmRef = useRef<null | { resolve: () => void; reject: (err: Error) => void }>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Sending…");
  const [sent, setSent] = useState<string | null>(null);
  const domain = useSolDomain(destination, cluster);
  const amountNum = Number(amount);
  const resolved = domain.status === "resolved" ? domain.address : destination.trim();
  const validAddress = isValidAddressForChain(resolved, "solana");
  // Private (MagicBlock exactOut): sender is debited amount + fees on top — never Max the full balance.
  const [chance, setChance] = useState(false);
  const buyChance = useChanceTicket(getAccessToken);
  const chanceCost = chance ? CHANCE_PRICE_USDC : 0;
  const maxSendable = Math.max(
    0,
    (privately ? balanceNum - PRIVATE_WITHDRAW_FEE_HEADROOM_USDC : balanceNum) - chanceCost,
  );
  const over = amountNum > maxSendable;
  const privateFeeExceedsBalance =
    privately && privateFee != null && amountNum + privateFee > balanceNum + 1e-6;

  useEffect(() => {
    if (!validAddress) { setRisk("idle"); setNeedsAccount(false); return; }
    setRisk("checking");
    let cancelled = false;
    const timer = setTimeout(async () => {
      const safe = await addressIsSafe(resolved);
      if (cancelled) return;
      setRisk(safe ? "safe" : "unsafe");
      if (privately) { setNeedsAccount(false); return; }
      try {
        const conn = new Connection(getRpcForMode(cluster), "confirmed");
        const ata = getAssociatedTokenAddressSync(getUsdcMintForMode(cluster), new PublicKey(resolved));
        const info = await conn.getAccountInfo(ata);
        if (!cancelled) setNeedsAccount(!info);
      } catch {
        if (!cancelled) setNeedsAccount(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [resolved, validAddress, privately, cluster]);

  const formatMax = (n: number) => (n > 0 ? n.toFixed(6).replace(/\.?0+$/, "") : "");
  const takeChance = async () => {
    if (!chance) return;
    setBusyLabel("Adding your chance…");
    const ok = await buyChance(wallet);
    setChance(false);
    if (ok) toast({ title: "You're in for today's draw", description: "Good luck, your chance to win $200K is in." });
  };

  const sendPublic = async (ataAcknowledged: boolean) => {
    if (!wallet || !userId) throw new Error("Your Loofta wallet is not ready yet.");
    const mode = cluster;
    const connection = new Connection(getRpcForMode(mode), "confirmed");
    const mint = getUsdcMintForMode(mode);
    let rent = 0;
    if (!ataAcknowledged) {
      const ata = getAssociatedTokenAddressSync(mint, new PublicKey(resolved));
      if (!(await connection.getAccountInfo(ata))) {
        if (ataFee >= amountNum) throw new Error(`This wallet needs a one-time $${ataFee.toFixed(2)} USDC account setup, which is more than you're sending.`);
        setNeedsAccount(true);
        setConfirmFee(ataFee);
        return;
      }
    } else {
      rent = ataFee;
    }
    await takeChance();
    setBusyLabel("Approve in your wallet…");
    const access = await getAccessToken();
    const sig = await sendUsdcWithBackendFeePayer({
      senderAddress: solanaAddress,
      recipientAddress: resolved,
      amountUSDC: amountNum - rent,
      connection,
      wallet,
      privyUserId: userId,
      signTransaction,
      usdcMint: mint,
      chain: getPrivySolanaChainForMode(mode),
      accessToken: access,
      network: mode,
      looftaFeeUsdc: rent > 0 ? rent : undefined,
    });
    await saveWithdrawal({
      id: sig,
      amountUSDC: amountNum,
      txSignature: sig,
      destinationAddress: resolved,
      destinationChain: "solana",
      destinationToken: "USDC",
      isNearIntents: false,
      nearIntentsComplete: true,
    }, access, devnetMode);
    setSent(sig);
    onRefresh?.();
  };

  const sendPrivate = async () => {
    if (!wallet || !userId) throw new Error("Your Loofta wallet is not ready yet.");
    await takeChance();
    setBusyLabel("Preparing private withdrawal…");
    const access = await getAccessToken();
    const anchor = privyStandardWalletToAnchorWallet(wallet, signTransaction, getPrivySolanaChainForMode(cluster));
    const result = await withdrawPrivately(anchor, {
      privyUserId: userId,
      accessToken: access,
      amountUsdc: amountNum,
      destinationAddress: resolved,
      onTxBuilt: ({ feeAmountUsdc }) => new Promise<void>((resolve, reject) => {
        setPrivateFee(feeAmountUsdc);
        setBusy(false);
        confirmRef.current = { resolve, reject };
      }),
    });
    await saveWithdrawal({
      id: result.signature,
      amountUSDC: amountNum,
      txSignature: result.signature,
      destinationAddress: resolved,
      destinationChain: "solana",
      destinationToken: "USDC",
      isNearIntents: false,
      nearIntentsComplete: false,
    }, access, devnetMode);
    setSent(result.signature);
    onRefresh?.();
  };

  const go = async (ataAcknowledged = false) => {
    if (!(amountNum > 0) || over || !validAddress || risk !== "safe") return;
    setBusy(true);
    setBusyLabel(privately ? "Preparing private withdrawal…" : "Sending…");
    try {
      if (privately) await sendPrivate();
      else await sendPublic(ataAcknowledged);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Withdrawal failed";
      if (msg !== "CANCELLED_BY_USER" && !/reject|cancel|denied/i.test(msg)) {
        toast({ variant: "destructive", title: "Withdrawal failed", description: msg });
      }
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <p className="text-base font-bold text-white">{privately ? "On its way, privately" : "Your USDC was sent"}</p>
        <p className="text-sm text-[#8A8893]">
          {privately
            ? "Your private transfer is being relayed and should arrive shortly."
            : "The transfer is confirmed on Solana. It should show up in the destination wallet right away."}
        </p>
        <a
          href={getExplorerTxUrl("solana", sent)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-base font-medium text-white underline underline-offset-4"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          View transaction
        </a>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <AmountField label="Amount (USDC)" value={amount} onChange={setAmount} onMax={() => setAmount(formatMax(maxSendable))} />
      {privately && (
        <p className="text-sm text-[#8A8893]">
          Available to send privately: ${maxSendable.toFixed(2)} USDC (${PRIVATE_WITHDRAW_FEE_HEADROOM_USDC.toFixed(2)} reserved for the relay fee)
        </p>
      )}
      {over && (
        <p className="text-sm text-red-400">
          {privately
            ? `That exceeds the $${maxSendable.toFixed(2)} you can send privately from your $${balanceNum.toFixed(2)} balance.`
            : `That is more than your $${balanceNum.toFixed(2)} balance.`}
        </p>
      )}
      <label className="block">
        <span className="text-sm font-semibold text-[#C8C6D0]">Solana address or .sol name</span>
        <input
          value={destination}
          onChange={(e) => { setDestination(e.target.value); setConfirmFee(null); }}
          placeholder="Wallet address"
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0E0E12] px-3 py-3 text-base text-white outline-none focus:border-[#FF7A2A]/60"
        />
      </label>
      {domain.status === "resolved" && <p className="text-sm text-[#8A8893]">Sends to {domain.address}</p>}
      {domain.status === "not-found" && <p className="text-sm text-red-400">That .sol name doesn&apos;t resolve.</p>}
      {domain.status === "error" && <p className="text-sm text-red-400">Couldn&apos;t look up that .sol name. Try again.</p>}
      {destination.trim() && !validAddress && domain.status !== "resolving" && domain.status !== "not-found" && domain.status !== "error" && (
        <p className="text-sm text-red-400">Enter a Solana address.</p>
      )}
      {risk === "checking" && <p className="text-sm text-[#8A8893]">Checking this address…</p>}
      {risk === "unsafe" && <p className="text-sm text-red-400">This address didn&apos;t pass the compliance check.</p>}
      {needsAccount && confirmFee != null && !privately && (
        <div className="rounded-2xl border border-white/10 bg-[#1A1A20] p-3 text-sm text-[#C8C6D0]">
          This wallet has never held USDC, so ${confirmFee.toFixed(2)} is used once to open the account. They receive ${(Math.max(0, amountNum - confirmFee)).toFixed(2)}.
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConfirmFee(null)} className="flex-1 rounded-xl border border-white/10 py-2 font-semibold text-white">Cancel</button>
            <button type="button" onClick={() => { setConfirmFee(null); void go(true); }} className="flex-1 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-2 font-semibold text-white">Confirm</button>
          </div>
        </div>
      )}
      {privateFee != null && (
        <div className="rounded-2xl border border-white/10 bg-[#1A1A20] p-3 text-sm text-[#C8C6D0]">
          {/* exactOut: destination gets the typed amount; fees are debited from the sender on top */}
          They receive ${amountNum.toFixed(2)} USDC. You pay ${privateFee.toFixed(2)} privacy fee on top (total ${(amountNum + privateFee).toFixed(2)}).
          {privateFeeExceedsBalance && (
            <p className="mt-2 text-red-400">
              Amount plus the ${privateFee.toFixed(2)} relay fee exceeds your ${balanceNum.toFixed(2)} balance — cancel and lower the amount.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => { setPrivateFee(null); confirmRef.current?.reject(new Error("CANCELLED_BY_USER")); confirmRef.current = null; }} className="flex-1 rounded-xl border border-white/10 py-2 font-semibold text-white">Cancel</button>
            <button
              type="button"
              disabled={privateFeeExceedsBalance}
              onClick={() => { setPrivateFee(null); setBusy(true); setBusyLabel("Approve in your wallet…"); confirmRef.current?.resolve(); confirmRef.current = null; }}
              className="flex-1 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-2 font-semibold text-white disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
      {balanceNum >= CHANCE_MIN_BALANCE_USDC && amountNum > 0 && (
        <ChanceUpsellCard
          dark
          price={CHANCE_PRICE_USDC}
          disabled={busy}
          checked={chance}
          onCheckedChange={(checked) => {
            setChance(checked);
            if (checked && amountNum + CHANCE_PRICE_USDC > (privately ? balanceNum - PRIVATE_WITHDRAW_FEE_HEADROOM_USDC : balanceNum)) {
              setAmount(formatMax(Math.max(0, (privately ? balanceNum - PRIVATE_WITHDRAW_FEE_HEADROOM_USDC : balanceNum) - CHANCE_PRICE_USDC)));
            }
          }}
        />
      )}
      <SendButton
        busy={busy}
        disabled={!(amountNum > 0) || over || !validAddress || risk !== "safe" || domain.status === "resolving" || (needsAccount && confirmFee != null) || privateFee != null}
        label={privately ? "Withdraw privately" : "Withdraw USDC"}
        busyLabel={busyLabel}
        onClick={() => { void go(false); }}
      />
    </div>
  );
}

function CryptoWithdraw({
  privately,
  balanceNum,
  tokens,
  solanaAddress,
  devnetMode,
  userId,
  getAccessToken,
  onRefresh,
}: {
  privately: boolean;
  balanceNum: number;
  tokens: NearToken[];
  solanaAddress: string;
  devnetMode: boolean;
  userId?: string;
  getAccessToken: () => Promise<string | null>;
  onRefresh?: () => void;
}) {
  const { toast } = useToast();
  const { withdraw: withdrawPrivately } = usePerPrivateSelfTransfer();
  const { wallet, signTransaction } = useLooftaSigner(solanaAddress);
  const [selection, setSelection] = useState<TokenSelection | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [privateFee, setPrivateFee] = useState<number | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const confirmRef = useRef<null | { resolve: () => void; reject: (err: Error) => void }>(null);
  const usdc = findUsdcOnSolana(tokens);
  const token = findTokenBySelection(tokens, selection);
  const choices = tokens.filter((t) => !isSolanaChain(t.chain) && (!usdc || t.tokenId !== usdc.tokenId));
  const amountNum = Number(amount);
  const addressOk = !!token && isValidAddressForChain(destination.trim(), token.chain);
  const [chance, setChance] = useState(false);
  const buyChance = useChanceTicket(getAccessToken);
  const chanceCost = chance ? CHANCE_PRICE_USDC : 0;
  const maxSendable = Math.max(
    0,
    (privately ? balanceNum - PRIVATE_WITHDRAW_FEE_HEADROOM_USDC : balanceNum) - chanceCost,
  );
  const over = amountNum > maxSendable;
  const privateFeeExceedsBalance =
    privately && privateFee != null && amountNum + privateFee > balanceNum + 1e-6;
  const formatMax = (n: number) => (n > 0 ? n.toFixed(6).replace(/\.?0+$/, "") : "");
  const takeChance = async () => {
    if (!chance) return;
        const ok = await buyChance(wallet);
    setChance(false);
    if (ok) toast({ title: "You're in for today's draw", description: "Good luck, your chance to win $200K is in." });
  };

  useEffect(() => {
    if (selection || choices.length === 0) return;
    const first = choices.find((t) => t.symbol.toUpperCase() === "ETH") ?? choices[0];
    if (first) setSelection({ symbol: first.symbol, chain: first.chain });
  }, [selection, choices]);

  useEffect(() => {
    setQuote(null);
    if (!token || !usdc || !(amountNum > 0)) return;
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const result = await getAccurateQuote({
          fromToken: usdc,
          toToken: token,
          amount: String(amountNum),
          slippageBps: 100,
          dryRun: true,
        });
        if (!cancelled) setQuote(result.amountOut && !result.error ? result.amountOut : null);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [token?.tokenId, usdc?.tokenId, amountNum, token, usdc]);

  const go = async () => {
    if (!wallet || !userId || !token || !usdc || !addressOk || !(amountNum > 0) || over) return;
    setBusy(true);
    try {
      await takeChance();
      const access = await getAccessToken();
      const cluster = devnetMode ? "devnet" : "mainnet";
      if (privately) {
        const anchor = privyStandardWalletToAnchorWallet(wallet, signTransaction, getPrivySolanaChainForMode(cluster));
        const result = await withdrawPrivately(anchor, {
          privyUserId: userId,
          accessToken: access,
          amountUsdc: amountNum,
          destinationAddress: destination.trim(),
          destinationToken: { symbol: token.symbol, chain: token.chain },
          onTxBuilt: ({ feeAmountUsdc }) => new Promise<void>((resolve, reject) => {
            setPrivateFee(feeAmountUsdc);
            setBusy(false);
            confirmRef.current = { resolve, reject };
          }),
        });
        await saveWithdrawal({
          id: result.signature,
          amountUSDC: amountNum,
          txSignature: result.signature,
          destinationAddress: destination.trim(),
          destinationChain: token.chain,
          destinationToken: token.symbol,
          isNearIntents: true,
          estimatedOut: quote ?? undefined,
          nearIntentsComplete: false,
        }, access, devnetMode);
        setSent(result.signature);
      } else {
        const order = await prepareNearIntentsWithdrawal({
          fromToken: usdc,
          toToken: token,
          amountUsdc: String(amountNum),
          destinationAddress: destination.trim(),
          refundAddress: solanaAddress,
          isDevnet: devnetMode,
        }, access);
        if (!order.depositAddress || !isValidAddressForChain(order.depositAddress, "solana")) {
          throw new Error("Couldn't get a deposit address for that token.");
        }
        const connection = new Connection(getRpcForMode(cluster), "confirmed");
        const sig = await sendUsdcWithBackendFeePayer({
          senderAddress: solanaAddress,
          recipientAddress: order.depositAddress,
          amountUSDC: amountNum,
          connection,
          wallet,
          privyUserId: userId,
          signTransaction,
          memo: order.memo ?? undefined,
          usdcMint: getUsdcMintForMode(cluster),
          chain: getPrivySolanaChainForMode(cluster),
          accessToken: access,
          network: cluster,
          nearIntentsOrderId: order.id,
        });
        await saveWithdrawal({
          id: sig,
          amountUSDC: amountNum,
          txSignature: sig,
          destinationAddress: destination.trim(),
          destinationChain: token.chain,
          destinationToken: token.symbol,
          isNearIntents: true,
          depositAddress: order.depositAddress,
          estimatedOut: quote ?? undefined,
          nearIntentsStatus: "PENDING",
          nearIntentsComplete: false,
        }, access, devnetMode);
        setSent(sig);
      }
      onRefresh?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Withdrawal failed";
      if (msg !== "CANCELLED_BY_USER" && !/reject|cancel|denied/i.test(msg)) {
        toast({ variant: "destructive", title: "Withdrawal failed", description: msg });
      }
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <p className="text-base font-bold text-white">{privately ? "On its way, privately" : "Your crypto is on its way"}</p>
        <p className="text-sm text-[#8A8893]">
          {privately
            ? `Your private transfer is being relayed. ${token ? `${token.symbol} on ${formatChainLabel(token.chain)}` : "Your crypto"} should arrive shortly.`
            : `Your USDC was sent and is being bridged. ${token ? `${token.symbol} on ${formatChainLabel(token.chain)}` : "Your crypto"} usually arrives within a few minutes.`}
        </p>
        <a
          href={getExplorerTxUrl("solana", sent)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-base font-medium text-white underline underline-offset-4"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          View transaction
        </a>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <label className="block">
        <span className="text-sm text-[#8A8893]">You receive</span>
        <div className="mt-1">
          <TokenCombobox tokens={choices} value={selection} defaultShowAllChains searchPlaceholder="Search BTC, ETH, ZEC…" placeholder="Search a token" onChange={(next) => { setSelection(next); setDestination(""); }} />
        </div>
      </label>
      <AmountField label="Amount to send (USDC)" value={amount} onChange={setAmount} onMax={() => setAmount(formatMax(maxSendable))} />
      {privately && (
        <p className="text-sm text-[#8A8893]">
          Available to send privately: ${maxSendable.toFixed(2)} USDC (${PRIVATE_WITHDRAW_FEE_HEADROOM_USDC.toFixed(2)} reserved for the relay fee)
        </p>
      )}
      {over && (
        <p className="text-sm text-red-400">
          {privately
            ? `That exceeds the $${maxSendable.toFixed(2)} you can send privately from your $${balanceNum.toFixed(2)} balance.`
            : `That is more than your $${balanceNum.toFixed(2)} balance.`}
        </p>
      )}
      {quoting && <p className="text-sm text-[#8A8893]">Getting a quote…</p>}
      {quote && token && <p className="text-sm text-[#C8C6D0]">You receive about {quote} {token.symbol}</p>}
      <label className="block">
        <span className="text-sm font-semibold text-[#C8C6D0]">{token ? `${formatChainLabel(token.chain)} address` : "Destination address"}</span>
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder={token ? `Your ${token.chain} address` : "Address"}
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0E0E12] px-3 py-3 text-base text-white outline-none focus:border-[#FF7A2A]/60"
        />
      </label>
      {destination.trim() && token && !addressOk && <p className="text-sm text-red-400">That address doesn&apos;t match {formatChainLabel(token.chain)}.</p>}
      {privateFee != null && (
        <div className="rounded-2xl border border-white/10 bg-[#1A1A20] p-3 text-sm text-[#C8C6D0]">
          Privacy fee ${privateFee.toFixed(2)} is charged on top of ${amountNum.toFixed(2)} (total ${(amountNum + privateFee).toFixed(2)}).
          {privateFeeExceedsBalance && (
            <p className="mt-2 text-red-400">
              Amount plus the ${privateFee.toFixed(2)} relay fee exceeds your ${balanceNum.toFixed(2)} balance — cancel and lower the amount.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => { setPrivateFee(null); confirmRef.current?.reject(new Error("CANCELLED_BY_USER")); confirmRef.current = null; }} className="flex-1 rounded-xl border border-white/10 py-2 font-semibold text-white">Cancel</button>
            <button
              type="button"
              disabled={privateFeeExceedsBalance}
              onClick={() => { setPrivateFee(null); setBusy(true); confirmRef.current?.resolve(); confirmRef.current = null; }}
              className="flex-1 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-2 font-semibold text-white disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
      {balanceNum >= CHANCE_MIN_BALANCE_USDC && amountNum > 0 && (
        <ChanceUpsellCard
          dark
          price={CHANCE_PRICE_USDC}
          disabled={busy}
          checked={chance}
          onCheckedChange={(checked) => {
            setChance(checked);
            if (checked && amountNum + CHANCE_PRICE_USDC > (privately ? balanceNum - PRIVATE_WITHDRAW_FEE_HEADROOM_USDC : balanceNum)) {
              setAmount(formatMax(Math.max(0, (privately ? balanceNum - PRIVATE_WITHDRAW_FEE_HEADROOM_USDC : balanceNum) - CHANCE_PRICE_USDC)));
            }
          }}
        />
      )}
      <SendButton
        busy={busy}
        disabled={!token || !addressOk || !(amountNum > 0) || over || privateFee != null || !wallet}
        label={privately ? "Withdraw privately" : `Withdraw${token ? ` to ${token.symbol}` : ""}`}
        busyLabel="Sending…"
        onClick={() => { void go(); }}
      />
    </div>
  );
}

function BankWithdraw({
  devnetMode,
  solanaAddress,
  balanceNum,
  getAccessToken,
  onPaj,
  onCashOut,
}: {
  devnetMode: boolean;
  solanaAddress: string | null;
  balanceNum: number;
  getAccessToken: () => Promise<string | null>;
  onPaj: () => void;
  onCashOut?: (pay: CashOutRequest) => void;
}) {
  const { toast } = useToast();
  const { user } = usePrivy();
  const [app, setApp] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [chance, setChance] = useState(false);
  const { wallet: chanceWallet } = useLooftaSigner(solanaAddress);
  const buyChance = useChanceTicket(getAccessToken);
  const platform = PEER_PLATFORMS.find((p) => p.id === app);
  const amountNum = Number(amount);
  const maxCashOut = Math.max(0, balanceNum - (chance ? CHANCE_PRICE_USDC : 0));

  const continueCashOut = async () => {
    if (!platform) return;
    if (chance) {
      setBusy(true);
      const ok = await buyChance(chanceWallet);
      setBusy(false);
      setChance(false);
      if (ok) toast({ title: "You're in for today's draw", description: "Good luck, your chance to win $200K is in." });
    }
    onCashOut?.({ platformId: platform.id, identifier: identifier.trim(), amountUsd: amountNum, intent: "receive" });
  };

  const openCoinbase = async () => {
    if (!solanaAddress) return;
    setBusy(true);
    try {
      const access = await getAccessToken();
      const sessionRes = await fetch("/api/coinbase/offramp-session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
        body: JSON.stringify({ walletAddress: solanaAddress, blockchains: ["solana"] }),
      });
      if (!sessionRes.ok) {
        const err = await sessionRes.json().catch(() => ({})) as { error?: string; detail?: string };
        throw new Error(err.detail || err.error || "Could not start Coinbase");
      }
      const { token } = await sessionRes.json();
      if (!token) throw new Error("No Coinbase session");
      const params = new URLSearchParams({
        appId: "68e3c83a-3d5a-49aa-a8fa-7ef26d824de1",
        sessionToken: token,
        defaultNetwork: "solana",
        defaultAsset: "USDC",
        redirectUrl: window.location.origin,
      });
      if (user?.id) params.set("partnerUserRef", user.id.slice(0, 50));
      window.open(`https://pay.coinbase.com/v3/sell/input?${params.toString()}`, "_blank");
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't open Coinbase", description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setBusy(false);
    }
  };

  if (devnetMode) {
    return <p className="mt-4 text-sm text-[#C8C6D0]">Bank cash-out is available on mainnet. Switch networks to send to Coinbase, PAJ Cash, or a bank app.</p>;
  }

  if (platform) {
    return (
      <div className="mt-4 flex flex-col gap-4">
        <button type="button" onClick={() => setApp(null)} className="self-start text-sm font-semibold text-[#C8C6D0] hover:text-white">{platform.name}</button>
        <AmountField
          label="Amount (USDC)"
          value={amount}
          onChange={setAmount}
          onMax={() => setAmount(maxCashOut > 0 ? maxCashOut.toFixed(6).replace(/\.?0+$/, "") : "")}
        />
        {amountNum > maxCashOut && <p className="text-sm text-red-400">That is more than your ${balanceNum.toFixed(2)} balance.</p>}
        <label className="block">
          <span className="text-sm font-semibold text-[#C8C6D0]">{platform.idLabel}</span>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={platform.placeholder}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0E0E12] px-3 py-3 text-base text-white outline-none focus:border-[#FF7A2A]/60"
          />
        </label>
        {balanceNum >= CHANCE_MIN_BALANCE_USDC && amountNum > 0 && (
          <ChanceUpsellCard
            dark
            price={CHANCE_PRICE_USDC}
            disabled={busy}
            checked={chance}
            onCheckedChange={(checked) => {
              setChance(checked);
              if (checked && amountNum + CHANCE_PRICE_USDC > balanceNum) {
                setAmount(Math.max(0, balanceNum - CHANCE_PRICE_USDC).toFixed(6).replace(/\.?0+$/, ""));
              }
            }}
          />
        )}
        <SendButton
          busy={busy}
          disabled={!(amountNum > 0) || amountNum > maxCashOut || identifier.trim().length < 2}
          label={`Continue with ${platform.name}`}
          busyLabel="Adding your chance…"
          onClick={() => { void continueCashOut(); }}
        />
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <button type="button" disabled={!solanaAddress || busy} onClick={() => { void openCoinbase(); }} className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#1A1A20] px-3.5 py-3 text-left hover:border-white/20 disabled:opacity-50">
        <img src="/images/icons/coinbase-logo.png" alt="" className="h-9 w-9 rounded-xl bg-[#0052FF] object-contain p-1.5" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-white">Coinbase</span>
          <span className="block text-sm text-[#8A8893]">Bank, card, or Apple Pay</span>
        </span>
      </button>
      {PAJ_CASH_ENABLED && (
        <button type="button" onClick={onPaj} className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#1A1A20] px-3.5 py-3 text-left hover:border-white/20">
          <img src="/images/icons/paj-cash-logo.svg" alt="" className="h-9 w-9 rounded-xl object-contain" />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-white">PAJ Cash</span>
            <span className="block text-sm text-[#8A8893]">Naira bank transfer</span>
          </span>
        </button>
      )}
      {PEER_PLATFORMS.map((item) => (
        <button key={item.id} type="button" onClick={() => setApp(item.id)} className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#1A1A20] px-3.5 py-3 text-left hover:border-white/20">
          <img src={item.logo} alt="" className="h-9 w-9 rounded-xl bg-[#1C1C22] object-contain p-1.5" />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-white">{item.name}</span>
            <span className="block text-sm text-[#8A8893]">{item.idLabel}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function PajWithdraw({
  devnetMode,
  solanaAddress,
  balanceNum,
  userId,
  getAccessToken,
  onBack,
  onRefresh,
}: {
  devnetMode: boolean;
  solanaAddress: string | null;
  balanceNum: number;
  userId?: string;
  getAccessToken: () => Promise<string | null>;
  onBack: () => void;
  onRefresh?: () => void;
}) {
  const { wallet, signTransaction } = useLooftaSigner(solanaAddress);
  if (!wallet || !solanaAddress) {
    return <p className="mt-4 text-sm text-[#C8C6D0]">Your Loofta wallet is still loading.</p>;
  }
  return (
    <div className="mt-4">
      <PajCashOfframpView
        dark
        devnetMode={devnetMode}
        solanaAddress={solanaAddress}
        wallet={wallet}
        signTransaction={signTransaction}
        userId={userId}
        maxAmountUsdc={balanceNum}
        getAccessToken={getAccessToken}
        onBack={onBack}
        onComplete={onRefresh}
      />
    </div>
  );
}

function isEvmChain(chain?: string) {
  return !!chain && ["eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism", "pol", "polygon", "matic", "monad", "bsc", "avax", "avalanche", "scroll", "linea"].includes(chain.toLowerCase());
}

function isSolanaChain(chain?: string) {
  return chain === "sol" || chain === "solana";
}
