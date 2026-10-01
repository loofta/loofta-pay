"use client";

/**
 * Two tabs: "Pay with Loofta" triggers a real login (the normal authenticated pay flow takes over
 * once that resolves; a new visitor gets a Loofta account/embedded wallet the same way sign-in
 * anywhere else in the app does — nothing checkout-specific about that part). "Pay as guest" never
 * touches Privy at all. "USDC on Solana" is a plain transfer straight to the payment link's
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
 * MagicBlock privacy for "USDC on Solana" goes through MagicBlock's own public Payments API
 * (https://payments.magicblock.app/v1/spl/transfer, visibility: "private", gasless: true) — a
 * stateless, third-party-hosted endpoint that only builds an unsigned transaction, never signs,
 * and never touches Loofta's backend or Privy at all (see services/magicblockPrivateTransfer.ts
 * and .claude/skills/magicblock/private-payments.md). No login required, guest or not: the
 * connected wallet (any Wallet Standard wallet, same as the plain-transfer case) only signs the
 * transfer authority — MagicBlock's own sponsor pays the SOL network fee and collects its own
 * relay fee automatically as part of the same transaction, no Loofta involvement in either. This
 * is deliberately a *different* mechanism from onPayPrivately in c/[id]/page.tsx (a
 * Privy-authorized MagicBlock PER transfer, backend-built by Loofta, used by the authenticated
 * "Pay now"/balance flow above) — that one exists to move funds out of a Loofta-custodied balance,
 * which needs to know whose balance it is; this one moves funds straight from an external wallet,
 * which doesn't. "Any token" (the NEAR Intents bridge) still has no private variant and stays
 * disabled while private mode is on.
 */

import { useEffect, useState } from "react";
import { Connection, VersionedTransaction, type Transaction } from "@solana/web3.js";
import { Loader2, VenetianMask } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { SolanaWalletConnectProvider, useWallet as useSolanaWalletAdapter, useWalletModal } from "@/components/SolanaWalletConnect";
import { buildUSDCTransferTransaction, sendSignedUSDCTransfer } from "@/services/solanaTransfer";
import { buildMagicBlockPrivateTransferNoFee, totalWithMagicBlockPrivateFee } from "@/services/magicblockPrivateTransfer";
import { getSolanaHttpRpc } from "@/lib/solanaCluster";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { privatePaymentAllPrivateLine } from "@/lib/privatePaymentCopy";
import { formatDelayDuration } from "@/lib/privacyDelay";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 3 * 60_000;

async function confirmClaimPaid(claimId: string, email: string, txHash?: string, isPrivate?: boolean): Promise<boolean> {
  // PRIVATE_TRANSFER_PENDING, not SUCCESS — a guest payment always lands in the claim's burner,
  // never the recipient's real wallet (see NearIntentsCheckoutOption's privacy comment), so the
  // recipient still has to claim/sweep it out. SUCCESS reads as "fully settled, nothing left to
  // do", which stranded funds with no visible claim action once a recipient landed on their own
  // claim page (incident 2026-08-26, payment 1352b7e4-c2f3-4e31-9bca-45ff88acc151).
  const res = await fetch(`/api/claims/${claimId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "PRIVATE_TRANSFER_PENDING", guest_email: email, txHash, ...(isPrivate ? { isPrivate: true } : {}) }),
  });
  return res.ok;
}

async function pollUntilSettled(claimId: string, email: string, txHash: string | undefined, isPrivate: boolean, shouldAbort: () => boolean): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (shouldAbort()) return false;
    if (await confirmClaimPaid(claimId, email, txHash, isPrivate)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

type PayFromWalletStatus = "idle" | "building" | "awaiting_signature" | "broadcasting" | "sent";

/** Single "Pay now" button for the USDC-on-Solana option — one click either way: if no wallet is
 *  connected yet it opens the wallet picker and auto-continues straight into the payment the
 *  moment a wallet connects, instead of making the guest connect, see a separate address readout,
 *  then click a second "Pay" button. Must render inside SolanaWalletConnectProvider. */
function UsdcSolanaWalletPanel({
  amountUsd,
  status,
  onPay,
  onViewQrInstead,
  private: isPrivate,
  delayMs,
}: {
  amountUsd: number;
  status: PayFromWalletStatus;
  onPay: (senderAddress: string, signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>) => void;
  /** Undefined (not a no-op function) when there's no QR fallback to offer — a private transfer
   *  can't be represented as "send to this address", it has to go through the Payments API. */
  onViewQrInstead?: () => void;
  private?: boolean;
  /** The delay chosen on the sliders above (0 when off) — shown as an ETA once sent, since a
   *  private transfer with a delay doesn't land immediately. */
  delayMs?: number;
}) {
  const { publicKey, signTransaction, connected, connecting, wallet, connect } = useSolanaWalletAdapter();
  const { setVisible } = useWalletModal();
  // Set by clicking "Pay" before a wallet is connected — the wallet picker only calls the
  // adapter's select() when a wallet is clicked (see WalletModal's handleWalletClick), never
  // connect() itself; normally a second click on WalletMultiButton is what triggers connect().
  // While this is true, the effect below drives that second step automatically: connect() the
  // moment a wallet is selected, then fire onPay the moment that connect() resolves — so picking
  // a wallet in the modal is the only extra step the guest ever has to take.
  const [pendingAutoPay, setPendingAutoPay] = useState(false);
  const canPay = connected && !!publicKey && !!signTransaction && status === "idle";
  const short = publicKey ? `${publicKey.toBase58().slice(0, 4)}..${publicKey.toBase58().slice(-4)}` : "";

  useEffect(() => {
    if (!pendingAutoPay) return;
    if (connected && publicKey && signTransaction) {
      setPendingAutoPay(false);
      onPay(publicKey.toBase58(), signTransaction);
    } else if (wallet && !connecting && !connected) {
      connect().catch(() => setPendingAutoPay(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoPay, connected, publicKey, signTransaction, wallet, connecting]);

  if (status === "sent") {
    return (
      <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400 flex items-center justify-center gap-1.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {isPrivate && delayMs ? `Sent — ${formatDelayDuration(delayMs)} to be funded and claimable by the recipient` : "Sent — waiting for confirmation…"}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          if (canPay) {
            onPay(publicKey!.toBase58(), signTransaction!);
          } else {
            setPendingAutoPay(true);
            setVisible(true);
          }
        }}
        disabled={status !== "idle"}
        className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50"
      >
        {status === "building" ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</>
        ) : status === "awaiting_signature" ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Confirm in your wallet…</>
        ) : status === "broadcasting" ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
        ) : (
          isPrivate
            ? `Pay $${totalWithMagicBlockPrivateFee(amountUsd).toFixed(2)} privately`
            : `Pay $${amountUsd.toFixed(2)} USDC`
        )}
      </button>

      {connected && publicKey && (
        <p className="text-center text-sm text-gray-400 [@media(prefers-color-scheme:dark)]:text-slate-500">Connected as {short}</p>
      )}

      {status === "idle" && onViewQrInstead && (
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
  onSettled,
  setError,
  isPrivateMode,
  initialSplit,
  initialDelayMs,
}: {
  claimId: string;
  burnerAddress: string;
  amountUsd: number;
  email: string;
  onSettled: () => void;
  setError: (e: string | null) => void;
  /** When true, the connected wallet builds and sends a private transfer via MagicBlock's public
   *  Payments API instead of a plain SPL transfer — see the file header comment. No auth needed
   *  either way; this only changes which transaction gets built. */
  isPrivateMode?: boolean;
  /** Carried over from GuestCheckoutPay's own props — see its doc comment. */
  initialSplit?: number;
  initialDelayMs?: number;
}) {
  const [payMethod, setPayMethod] = useState<"wallet" | "qr">("wallet");
  const [payStatus, setPayStatus] = useState<PayFromWalletStatus>("idle");
  // Split/delay were already chosen once, on the Send form that created this link (carried over
  // via initialSplit/initialDelayMs) — this screen reuses them silently instead of showing the
  // same sliders again for the guest to redo.
  const split = initialSplit && initialSplit >= 1 ? initialSplit : 1;
  const delayMs = initialDelayMs && initialDelayMs >= 0 ? initialDelayMs : 0;
  // Set once the wallet-connect send succeeds, so the settlement poll below can check the exact
  // tx instead of only the burner's balance — the QR flow has no such hash, since any wallet
  // could have sent it at any time.
  const [sentTxHash, setSentTxHash] = useState<string | undefined>(undefined);

  // This component only ever mounts once a valid email is on file (GuestCheckoutPay renders it
  // conditionally below), so the settlement poll can just run for its whole lifetime instead of
  // waiting on a separate "expanded" flag from an outer tile picker that no longer exists.
  useEffect(() => {
    let aborted = false;
    setError(null);
    pollUntilSettled(claimId, email, sentTxHash, !!isPrivateMode, () => aborted).then((settled) => {
      if (aborted) return;
      if (settled) onSettled();
      else setError("Still waiting for the deposit to arrive. Refresh in a moment once you've sent it.");
    });
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentTxHash]);

  const handlePayFromWallet = async (
    senderAddress: string,
    signTx: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>,
  ) => {
    setError(null);
    setPayStatus("building");
    try {
      const connection = new Connection(getSolanaHttpRpc(), "confirmed");

      let signature: string;
      if (isPrivateMode) {
        // No Loofta fee here — this is an unauthenticated guest paying from their own external
        // wallet, not a Loofta-custodied balance, so there's nothing for Loofta to sponsor or take
        // a cut on; MagicBlock's own sponsor already covers gas and collects its own relay fee.
        // (buildMagicBlockPrivateTransferWithLooftaFee is for flows that DO take a Loofta cut, and
        // requires NEXT_PUBLIC_SOLANA_FEE_ATA_WALLET to be configured — not needed or wanted here.)
        const tx = await buildMagicBlockPrivateTransferNoFee({
          from: senderAddress,
          to: burnerAddress,
          amountUSDC: amountUsd,
          memo: claimId,
          split,
          maxDelayMs: delayMs,
        });

        setPayStatus("awaiting_signature");
        const signed = await signTx(tx);

        setPayStatus("broadcasting");
        signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });
      } else {
        const tx = await buildUSDCTransferTransaction({
          senderAddress,
          recipientAddress: burnerAddress,
          amountUSDC: amountUsd,
          connection,
        });

        setPayStatus("awaiting_signature");
        const signed = await signTx(tx);

        setPayStatus("broadcasting");
        signature = await sendSignedUSDCTransfer(signed as VersionedTransaction, connection);
      }
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
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3 text-center [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:bg-white/5">
      {payMethod === "wallet" || isPrivateMode ? (
        <SolanaWalletConnectProvider rpcUrl={getSolanaHttpRpc()}>
          <UsdcSolanaWalletPanel
            amountUsd={amountUsd}
            status={payStatus}
            onPay={handlePayFromWallet}
            onViewQrInstead={isPrivateMode ? undefined : () => setPayMethod("qr")}
            private={isPrivateMode}
            delayMs={delayMs}
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
  initialSplit,
  initialDelayMs,
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
  /** Carried over from the Send form's own split/delay sliders (app/app/page.tsx's
   *  privacyQuery()) via ?split=&delayMs=, so these start from that choice instead of
   *  resetting to 1/0 — see UsdcSolanaOption below. */
  initialSplit?: number;
  initialDelayMs?: number;
}) {
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailValid = isValidEmail(email);

  // The link's own requiresPrivate always wins, same as the parent's payingPrivately = requiresPrivate
  // || isPrivateMode — the raw switch state alone isn't enough here, or a mandatory-private link
  // would still pass isPrivateMode=false down to the option tiles below whenever the guest hasn't
  // (or, per the bug this fixed, has tried and failed to) touch the switch themselves.
  const effectivePrivate = requiresPrivate || !!isPrivateMode;

  // No tab switcher — signing in is just the "Sign in to pay" link at the bottom, so there's only
  // ever one flow on screen. `authenticated` (set only for checkout links a signed-in visitor
  // lands on) swaps the whole card for the balance-based "Pay now" button instead.
  if (authenticated) {
    return (
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
    );
  }

  return (
    <div className="space-y-4">
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
          <p className="text-sm text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-300">{privatePaymentAllPrivateLine(initialDelayMs)}</p>
        </div>
      ) : onTogglePrivateMode ? (
        <IncognitoModeToggle checked={!!isPrivateMode} onCheckedChange={onTogglePrivateMode} light />
      ) : null}

      {emailValid ? (
        <UsdcSolanaOption
          claimId={claimId}
          burnerAddress={burnerAddress}
          amountUsd={amountUsd}
          email={email}
          onSettled={onSettled}
          setError={setError}
          isPrivateMode={effectivePrivate}
          initialSplit={initialSplit}
          initialDelayMs={initialDelayMs}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEmailTouched(true)}
          className="w-full rounded-xl border border-dashed border-gray-300 p-4 text-center text-base text-gray-400 [@media(prefers-color-scheme:dark)]:border-white/15 [@media(prefers-color-scheme:dark)]:text-slate-500"
        >
          Enter your email above to connect a wallet and pay
        </button>
      )}

      {/* Any other token, or a card, or paying from a Loofta balance — all need Privy sign-in
          (Any token's NEAR Intents bridge and the balance-based Pay Now button both live behind
          the authenticated flow; card on-ramps here are Privy fundWallet()/PAJ Cash, both
          inherently session-based). One plain link instead of a second tab/CTA competing with the
          wallet-connect flow above. */}
      <button
        type="button"
        onClick={onLogin}
        className="w-full text-center text-sm text-gray-400 hover:text-gray-600 underline underline-offset-2 [@media(prefers-color-scheme:dark)]:text-slate-500 [@media(prefers-color-scheme:dark)]:hover:text-slate-300"
      >
        Want to pay with a different token or by card? Sign in to pay
      </button>

      {error && <p className="text-base text-red-600 [@media(prefers-color-scheme:dark)]:text-red-400 text-center">{error}</p>}
    </div>
  );
}
