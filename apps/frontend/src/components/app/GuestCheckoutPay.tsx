"use client";

/**
 * Checkout for someone with no Loofta account: "Pay with Loofta" triggers a real login (the
 * normal authenticated pay flow takes over once that resolves) — everything below that divider
 * never touches Privy at all. "USDC on Solana" is a plain transfer straight to the payment link's
 * own burner address (no swap, no vendor involved at all). "Any token" is NearIntentsAnyTokenOption
 * (components/app/NearIntentsCheckoutOption.tsx) — pick a token/chain via the same TokenCombobox
 * used everywhere else, connect a wallet matched to that chain for the refund address, and pay to
 * a generated NEAR Intents deposit address. A backend cron (claim-processor.service.ts) finalizes
 * settlement independently by watching that deposit; this component's own settlement confirmation
 * (PATCH /api/claims/[id], which for a guest checks the claim's burner balance on-chain) is only
 * used by the other, directly-verifiable option below (USDC on Solana).
 *
 * Card (Coinbase/MoonPay/PAJ Cash) is deliberately not offered here for now. MoonPay in this
 * codebase is wired exclusively through Privy's fundWallet() (funds the *logged-in user's own
 * wallet*, no destination-address param, and no standalone MoonPay credentials exist anywhere in
 * this codebase to build around that). PAJ Cash's flow (KYC, OTP, bank-account linking) is
 * inherently session/identity-based across multiple steps, not a one-shot API call — making it
 * guest-capable means redesigning that flow, not adding a parameter.
 *
 * MagicBlock privacy only ever goes through one real mechanism in this codebase: onPayPrivately
 * in c/[id]/page.tsx, a MagicBlock PER transfer signed by a connected wallet (Phantom) but
 * authorized by a Privy access token — there's no guest-capable private-transfer path, and this
 * component doesn't invent one. So the "Pay privately" switch here (above the token/method
 * selection) only actually applies to USDC on Solana and the authenticated "Pay with Loofta" /
 * balance flow — "Any token" (the NEAR Intents bridge) has no private variant and is disabled
 * while it's on. For USDC on Solana specifically: if private is on and the guest isn't signed in,
 * that tile shows "sign in to pay privately" instead of its normal wallet-connect/QR flow — once
 * signed in, the top button becomes the authenticated "Pay now" balance flow, which already routes
 * through onPayPrivately when isPrivateMode is set. Nothing here builds a new private-transfer
 * mechanism; it only decides when to reuse the existing one vs. require login for it.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { Connection, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { Loader2, LogIn, VenetianMask } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { NearIntentsAnyTokenOption } from "@/components/app/NearIntentsCheckoutOption";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { SolanaWalletConnectProvider, useWallet as useSolanaWalletAdapter, WalletMultiButton } from "@/components/SolanaWalletConnect";
import { buildUSDCTransferTransaction, sendSignedUSDCTransfer } from "@/services/solanaTransfer";
import { getSolanaHttpRpc } from "@/lib/solanaCluster";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { PRIVATE_PAYMENT_ALL_PRIVATE_LINE } from "@/lib/privatePaymentCopy";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 3 * 60_000;

async function confirmClaimPaid(claimId: string, email: string, txHash?: string): Promise<boolean> {
  // PRIVATE_TRANSFER_PENDING, not SUCCESS — a guest payment always lands in the claim's burner,
  // never the recipient's real wallet (see NearIntentsCheckoutOption's privacy comment), so the
  // recipient still has to claim/sweep it out. SUCCESS reads as "fully settled, nothing left to
  // do", which stranded funds with no visible claim action once a recipient landed on their own
  // claim page (incident 2026-08-26, payment 1352b7e4-c2f3-4e31-9bca-45ff88acc151).
  const res = await fetch(`/api/claims/${claimId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "PRIVATE_TRANSFER_PENDING", guest_email: email, txHash }),
  });
  return res.ok;
}

async function pollUntilSettled(claimId: string, email: string, txHash: string | undefined, shouldAbort: () => boolean): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (shouldAbort()) return false;
    if (await confirmClaimPaid(claimId, email, txHash)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

type PayFromWalletStatus = "idle" | "building" | "awaiting_signature" | "broadcasting" | "sent";

/** Connect-wallet panel for the USDC-on-Solana option — Phantom/Solflare (or any other Wallet
 *  Standard wallet) via the same SolanaWalletConnectProvider/WalletMultiButton pair used for
 *  private deposits in BalanceModal. Must render inside SolanaWalletConnectProvider. */
function UsdcSolanaWalletPanel({
  amountUsd,
  status,
  onPay,
  onViewQrInstead,
}: {
  amountUsd: number;
  status: PayFromWalletStatus;
  onPay: (senderAddress: string, signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>) => void;
  onViewQrInstead: () => void;
}) {
  const { publicKey, signTransaction, connected, disconnect } = useSolanaWalletAdapter();
  const canPay = connected && !!publicKey && !!signTransaction && status === "idle";
  const short = publicKey ? `${publicKey.toBase58().slice(0, 4)}..${publicKey.toBase58().slice(-4)}` : "";

  if (status === "sent") {
    return (
      <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400 flex items-center justify-center gap-1.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sent — waiting for confirmation…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {connected && publicKey ? (
        <div className="flex items-center justify-center gap-2 rounded-lg bg-white border border-gray-200 py-2 [@media(prefers-color-scheme:dark)]:bg-black/20 [@media(prefers-color-scheme:dark)]:border-white/10">
          <span className="text-sm font-mono text-gray-700 [@media(prefers-color-scheme:dark)]:text-slate-300">{short}</span>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="text-sm underline underline-offset-2 text-gray-400 hover:text-gray-700 [@media(prefers-color-scheme:dark)]:text-slate-500 [@media(prefers-color-scheme:dark)]:hover:text-white"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="[&_.wallet-adapter-dropdown]:block [&_.wallet-adapter-dropdown]:w-full [&_.wallet-adapter-button]:w-full [&_.wallet-adapter-button]:justify-center [&_.wallet-adapter-button]:h-10 [&_.wallet-adapter-button]:rounded-lg [&_.wallet-adapter-button]:text-sm [&_.wallet-adapter-button]:font-semibold [&_.wallet-adapter-button]:font-sans">
          <WalletMultiButton style={{ background: "linear-gradient(135deg,#FF4A26,#FF8C00)" }} />
        </div>
      )}

      {connected && publicKey && signTransaction && (
        <button
          type="button"
          onClick={() => onPay(publicKey.toBase58(), signTransaction)}
          disabled={!canPay}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50"
        >
          {status === "building" ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</>
          ) : status === "awaiting_signature" ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Confirm in your wallet…</>
          ) : status === "broadcasting" ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
          ) : (
            `Pay $${amountUsd.toFixed(2)} USDC`
          )}
        </button>
      )}

      {status === "idle" && (
        <button
          type="button"
          onClick={onViewQrInstead}
          className="w-full text-center text-base underline underline-offset-2 text-gray-400 hover:text-gray-700 [@media(prefers-color-scheme:dark)]:text-slate-500 [@media(prefers-color-scheme:dark)]:hover:text-white"
        >
          Or scan a QR code instead
        </button>
      )}
    </div>
  );
}

// Direct transfer to the payment link's own burner address — no swap/bridge involved at all,
// since USDC on Solana already *is* the destination asset. Simplest and fastest option, and the
// only one with no refund-address requirement (nothing can be "refunded", it's a plain transfer).
// Default entry is a connected wallet (Phantom/Solflare/etc, same as BalanceModal's private
// deposit flow) — sender pays their own network fee, no sponsorship, no backend tx-building
// needed since it's a plain SPL transfer (buildUSDCTransferTransaction handles ATA creation if
// the burner doesn't have one yet). The original QR/manual-send flow stays as a fallback for
// guests without a browser wallet.
function UsdcSolanaOption({
  claimId,
  burnerAddress,
  amountUsd,
  email,
  expanded,
  onToggle,
  onSettled,
  setError,
  isPrivateMode,
  authenticated,
  onLogin,
  onPayWithLoofta,
}: {
  claimId: string;
  burnerAddress: string;
  amountUsd: number;
  email: string;
  expanded: boolean;
  onToggle: () => void;
  onSettled: () => void;
  setError: (e: string | null) => void;
  /** When true, this tile's own plain-SPL-transfer flow is always blocked, signed in or not — it
   *  can't provide real privacy and, critically, never added the privacy fee to the amount it
   *  sent, so silently letting it through once merely *signed in* (a past bug here) built and
   *  broadcast an unprivate, under-charged transfer while the UI still showed a privacy fee line
   *  item. Once authenticated, onPayWithLoofta below reuses the actual mechanism instead — same
   *  onPayPrivately MagicBlock PER transfer the top "Pay now" button already triggers. */
  isPrivateMode?: boolean;
  authenticated?: boolean;
  onLogin: () => void;
  /** The real private-transfer trigger (Phantom connect + MagicBlock PER, see onPayPrivately in
   *  c/[id]/page.tsx) — only meaningful once authenticated; not this component's own to build. */
  onPayWithLoofta?: () => void;
}) {
  const [payMethod, setPayMethod] = useState<"wallet" | "qr">("wallet");
  const [payStatus, setPayStatus] = useState<PayFromWalletStatus>("idle");
  // Set once the wallet-connect send succeeds, so the settlement poll below can check the exact
  // tx instead of only the burner's balance — the QR flow has no such hash, since any wallet
  // could have sent it at any time.
  const [sentTxHash, setSentTxHash] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!expanded) return;
    let aborted = false;
    setError(null);
    pollUntilSettled(claimId, email, sentTxHash, () => aborted).then((settled) => {
      if (aborted) return;
      if (settled) onSettled();
      else setError("Still waiting for the deposit to arrive. Refresh in a moment once you've sent it.");
    });
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, sentTxHash]);

  const handlePayFromWallet = async (
    senderAddress: string,
    signTx: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>,
  ) => {
    setError(null);
    setPayStatus("building");
    try {
      const connection = new Connection(getSolanaHttpRpc(), "confirmed");
      const tx = await buildUSDCTransferTransaction({
        senderAddress,
        recipientAddress: burnerAddress,
        amountUSDC: amountUsd,
        connection,
      });

      setPayStatus("awaiting_signature");
      const signed = await signTx(tx);

      setPayStatus("broadcasting");
      const signature = await sendSignedUSDCTransfer(signed as VersionedTransaction, connection);
      await waitForSignatureConfirmation(connection, signature, 60_000, 1500, "guestCheckoutUsdcSolana");

      setSentTxHash(signature);
      setPayStatus("sent");
    } catch (e: any) {
      setPayStatus("idle");
      const msg = e?.message;
      setError(typeof msg === "string" && msg.length < 200 ? msg : "Payment failed — please try again.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${
          expanded
            ? "border-orange-400 bg-orange-50 [@media(prefers-color-scheme:dark)]:bg-orange-500/10"
            : "border-gray-200 hover:bg-gray-50 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:hover:bg-white/5"
        }`}
      >
        <Image src="/images/icons/withdraw-usdc.svg" alt="" width={32} height={32} className="object-contain" />
        <span className="text-base font-medium text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">USDC on Solana</span>
      </button>

      {expanded && (
        <div className="col-span-2 [grid-row:2] rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3 text-center [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:bg-white/5">
          {isPrivateMode ? (
            <>
              <p className="text-base text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-300">
                {authenticated
                  ? "Private payments go through a MagicBlock transfer, signed by your connected wallet and authorized by your Loofta account."
                  : "Private payments use a MagicBlock transfer straight to the recipient — that needs a Loofta account to authorize."}
              </p>
              <button
                type="button"
                onClick={authenticated ? onPayWithLoofta : onLogin}
                className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
              >
                {authenticated ? (
                  <>Pay ${amountUsd.toFixed(2)} privately</>
                ) : (
                  <><LogIn className="w-4 h-4" /> Sign in to pay privately</>
                )}
              </button>
            </>
          ) : payMethod === "wallet" ? (
            <SolanaWalletConnectProvider rpcUrl={getSolanaHttpRpc()}>
              <UsdcSolanaWalletPanel
                amountUsd={amountUsd}
                status={payStatus}
                onPay={handlePayFromWallet}
                onViewQrInstead={() => setPayMethod("qr")}
              />
            </SolanaWalletConnectProvider>
          ) : (
            <>
              <QRCodeSVG value={burnerAddress} size={140} className="mx-auto rounded-lg bg-white p-2 border border-gray-200" />
              <div>
                <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">Send exactly</p>
                <p className="text-lg font-semibold text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">${amountUsd.toFixed(2)} USDC</p>
                <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">on Solana</p>
              </div>
              <div className="rounded-lg bg-white border border-gray-200 px-3 py-2 break-all text-base font-mono text-gray-700 [@media(prefers-color-scheme:dark)]:bg-black/20 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:text-slate-300">{burnerAddress}</div>
              <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400 flex items-center justify-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for it to arrive…</p>
              <button
                type="button"
                onClick={() => setPayMethod("wallet")}
                className="w-full text-center text-base underline underline-offset-2 text-gray-400 hover:text-gray-700 [@media(prefers-color-scheme:dark)]:text-slate-500 [@media(prefers-color-scheme:dark)]:hover:text-white"
              >
                Or pay with a connected wallet instead
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

export function GuestCheckoutPay({
  claimId,
  burnerAddress,
  amountUsd,
  onLogin,
  onSettled,
  authenticated = false,
  looftaBalanceUSD,
  onPayWithLoofta,
  isPrivateMode,
  onTogglePrivateMode,
  requiresPrivate = false,
}: {
  claimId: string;
  burnerAddress: string;
  amountUsd: number;
  onLogin: () => void;
  onSettled: () => void;
  /** Checkout links show this card to every visitor, signed in or not (see c/[id]/page.tsx) — set
   *  when the visitor is already signed in, so the top action becomes a balance readout instead of
   *  a login button. The guest options below (email, USDC on Solana, any token) stay available
   *  either way, in case a signed-in visitor wants to pay a different way than their own balance. */
  authenticated?: boolean;
  looftaBalanceUSD?: number;
  onPayWithLoofta?: () => void;
  /** "Pay privately" switch state, owned by the parent (c/[id]/page.tsx uses the same state for
   *  its own authenticated Pay Now flow) — this component only renders it, above the token/method
   *  selection below. See the file header comment: it doesn't change how the guest's payment
   *  actually goes out. */
  isPrivateMode?: boolean;
  onTogglePrivateMode?: (checked: boolean) => void;
  /** The link's own claim.is_private — when true, the parent's payingPrivately is `requiresPrivate
   *  || isPrivateMode`, so flipping the switch off here can never actually turn privacy off (the
   *  OR keeps it true) even though the switch itself looks interactive. That was the bug: a switch
   *  you could visibly toggle off while the fee breakdown stayed on the private number regardless.
   *  When this is true, show a locked, checked, non-interactive row instead of a real switch. */
  requiresPrivate?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailValid = isValidEmail(email);
  // Only one payment-option panel open at a time — both live in the same 2-column grid row, so
  // showing both simultaneously would either overlap (each pinned to row 2) or push one tile onto
  // a third row depending on which expanded first. Keeping this exclusive keeps the QR/deposit
  // panel pinned directly under both tiles, never wedged between them.
  const [activeOption, setActiveOption] = useState<"usdc" | "any" | null>(null);

  // The link's own requiresPrivate always wins, same as the parent's payingPrivately = requiresPrivate
  // || isPrivateMode — the raw switch state alone isn't enough here, or a mandatory-private link
  // would still pass isPrivateMode=false down to the option tiles below whenever the guest hasn't
  // (or, per the bug this fixed, has tried and failed to) touch the switch themselves.
  const effectivePrivate = requiresPrivate || !!isPrivateMode;

  // "Any token" has no private variant (see NearIntentsAnyTokenOption's disabled prop) — collapse
  // it if the guest had it open and then switches private mode on.
  useEffect(() => {
    if (effectivePrivate && activeOption === "any") setActiveOption(null);
  }, [effectivePrivate, activeOption]);

  return (
    <div className="space-y-4">
      {authenticated ? (
        <button
          type="button"
          onClick={onPayWithLoofta}
          className="w-full flex items-center justify-between gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
        >
          <span>Pay now</span>
          <span className="text-sm font-medium opacity-90">
            Balance: {typeof looftaBalanceUSD === "number" ? `$${looftaBalanceUSD.toFixed(2)}` : "…"}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onLogin}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
        >
          <LogIn className="w-4 h-4" /> Pay with Loofta
        </button>
      )}

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200 [@media(prefers-color-scheme:dark)]:bg-white/10" />
        <span className="text-base text-gray-400 [@media(prefers-color-scheme:dark)]:text-slate-500">or pay another way</span>
        <div className="h-px flex-1 bg-gray-200 [@media(prefers-color-scheme:dark)]:bg-white/10" />
      </div>

      <div>
        <label className="text-base text-gray-500 mb-1 block [@media(prefers-color-scheme:dark)]:text-slate-400">Email <span className="text-gray-400 [@media(prefers-color-scheme:dark)]:text-slate-500">&middot; enter this first to unlock the options below</span></label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTouched(true)}
          placeholder="you@example.com"
          autoFocus
          className={`w-full rounded-lg bg-white border px-3 py-2 text-base text-gray-900 outline-none [@media(prefers-color-scheme:dark)]:bg-black/20 [@media(prefers-color-scheme:dark)]:text-slate-100 ${
            emailTouched && !emailValid ? "border-red-400 focus:border-red-500" : "border-gray-300 focus:border-orange-400 [@media(prefers-color-scheme:dark)]:border-white/20"
          }`}
        />
        {emailTouched && !emailValid && <p className="text-base text-red-600 mt-1 [@media(prefers-color-scheme:dark)]:text-red-400">Enter a valid email to continue.</p>}
      </div>

      {requiresPrivate ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:bg-white/5">
          <VenetianMask className="h-4 w-4 shrink-0 text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-300" strokeWidth={1.75} />
          <p className="text-sm text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-300">{PRIVATE_PAYMENT_ALL_PRIVATE_LINE}</p>
        </div>
      ) : onTogglePrivateMode ? (
        <IncognitoModeToggle checked={!!isPrivateMode} onCheckedChange={onTogglePrivateMode} light />
      ) : null}

      {/* Guest email is irrelevant once private mode is on — that path either needs a real sign-in
          (no guest identity involved at all) or reuses the authenticated balance flow above (which
          already has the account's real email on file) — so the fieldset's email gate is skipped
          in that case, or the "sign in"/"pay privately" actions inside it would stay disabled until
          a guest typed something that's never actually used. */}
      <fieldset disabled={!emailValid && !effectivePrivate} className="grid grid-cols-2 gap-2 disabled:opacity-50" onClick={() => !emailValid && !effectivePrivate && setEmailTouched(true)}>
        <UsdcSolanaOption
          claimId={claimId}
          burnerAddress={burnerAddress}
          amountUsd={amountUsd}
          email={email}
          expanded={activeOption === "usdc"}
          onToggle={() => setActiveOption((v) => (v === "usdc" ? null : "usdc"))}
          onSettled={onSettled}
          setError={setError}
          isPrivateMode={effectivePrivate}
          authenticated={authenticated}
          onLogin={onLogin}
          onPayWithLoofta={onPayWithLoofta}
        />
        <NearIntentsAnyTokenOption
          claimId={claimId}
          amountUsd={amountUsd}
          email={email}
          expanded={activeOption === "any"}
          onToggle={() => setActiveOption((v) => (v === "any" ? null : "any"))}
          onSettled={onSettled}
          setError={setError}
          disabled={effectivePrivate}
        />
      </fieldset>

      {error && <p className="text-base text-red-600 [@media(prefers-color-scheme:dark)]:text-red-400 text-center">{error}</p>}

      <div className="flex items-center justify-center gap-1.5 text-base text-gray-400 [@media(prefers-color-scheme:dark)]:text-slate-500 pt-1">
        <span className="leading-none">Powered by</span>
        <span className="relative inline-block h-3 w-16 shrink-0">
          <Image src="/loofta.svg" alt="Loofta" fill className="object-contain object-left [@media(prefers-color-scheme:dark)]:hidden" />
          <Image src="/loofta-white.svg" alt="Loofta" fill className="hidden object-contain object-left [@media(prefers-color-scheme:dark)]:block" />
        </span>
      </div>
    </div>
  );
}
