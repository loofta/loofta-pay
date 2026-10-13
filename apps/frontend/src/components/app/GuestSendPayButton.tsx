"use client";

/**
 * One-step guest send to a handle/email: a single button connects an external Solana wallet,
 * creates the guest claim (Turnstile-gated create-*-guest endpoint), pays its burner, confirms
 * settlement, then hands the claim id back so the caller can redirect to /c/[id] — which shows
 * the share link to this device's guest sender (see markGuestSentClaim).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { SolanaWalletConnectProvider, useWallet as useSolanaWalletAdapter, useWalletModal } from "@/components/SolanaWalletConnect";
import { payGuestClaimFromWallet, pollUntilSettled } from "@/components/app/GuestCheckoutPay";
import { totalWithMagicBlockPrivateFee } from "@/services/magicblockPrivateTransfer";
import { getSolanaHttpRpc } from "@/lib/solanaCluster";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile";
import { markGuestSentClaim } from "@/lib/guestSentClaims";

// Stable identity: @marsidev/react-turnstile re-inits the widget whenever `options` changes.
const TURNSTILE_OPTIONS = { appearance: "interaction-only" as const };

/** Cloudflare's real sitekey rejects localhost (domain not authorized), so local guest sends
 *  skip the widget. The local backend accepts this only when it is not running in production. */
function isLocalhostPage(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export type GuestClaim = { id: string; burnerAddress: string; direct?: boolean };

type Status = "idle" | "connecting" | "creating" | "building" | "awaiting_signature" | "broadcasting" | "confirming";

export type GuestSendButtonRender = (props: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  label: string;
}) => ReactNode;

type Props = {
  amountUsd: number;
  platformFeeUsd: number;
  isPrivate: boolean;
  split: number;
  delayMs: number;
  /** Non-null disables the button and becomes its label. */
  blocker: string | null;
  /** Changes whenever the recipient/amount/privacy inputs change, so a claim created for an
   *  earlier attempt (e.g. wallet signature rejected) is only reused for the same inputs. */
  claimKey: string;
  createClaim: (turnstileToken: string) => Promise<GuestClaim>;
  onPaid: (claimId: string) => void;
  onError: (message: string) => void;
  renderButton: GuestSendButtonRender;
};

function Inner({
  amountUsd,
  platformFeeUsd,
  isPrivate,
  split,
  delayMs,
  blocker,
  claimKey,
  createClaim,
  onPaid,
  onError,
  renderButton,
}: Props) {
  const { publicKey, signTransaction, signAllTransactions, connected, connecting, wallet, connect } = useSolanaWalletAdapter();
  const { visible: walletModalVisible, setVisible } = useWalletModal();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [skipBotCheck, setSkipBotCheck] = useState(false);
  const [botCheckReady, setBotCheckReady] = useState(false);
  useEffect(() => {
    setSkipBotCheck(isLocalhostPage());
    setBotCheckReady(true);
  }, []);
  const [status, setStatus] = useState<Status>("idle");
  const [pendingAutoPay, setPendingAutoPay] = useState(false);
  const claimRef = useRef<{ key: string; claim: GuestClaim } | null>(null);

  const pay = async (
    senderAddress: string,
    signTx: NonNullable<typeof signTransaction>,
    signAll: NonNullable<typeof signAllTransactions> | undefined,
  ) => {
    try {
      let claim = claimRef.current?.key === claimKey ? claimRef.current.claim : null;
      if (!claim) {
        const local = isLocalhostPage();
        if (!turnstileToken && !local) {
          onError("Still verifying you're not a bot. Try again in a moment.");
          setStatus("idle");
          return;
        }
        setStatus("creating");
        claim = await createClaim(turnstileToken ?? "localhost");
        claimRef.current = { key: claimKey, claim };
        markGuestSentClaim(claim.id);
        // Turnstile tokens are single-use.
        setTurnstileToken(null);
      }
      const signature = await payGuestClaimFromWallet({
        claimId: claim.id,
        burnerAddress: claim.burnerAddress,
        amountUsd,
        platformFeeUsd: claim.direct ? 0 : platformFeeUsd,
        isPrivate,
        split,
        delayMs,
        senderAddress,
        signTx,
        signAllTransactions: signAll,
        onStatus: setStatus,
      });
      setStatus("confirming");
      // Broadcast already happened. Drop the reusable claim before recording so a failed
      // save cannot send the same payment a second time.
      const paidClaim = claim;
      claimRef.current = null;
      const settled = await pollUntilSettled(paidClaim.id, "", signature, isPrivate, () => false, {
        senderWallet: senderAddress,
        direct: !!paidClaim.direct,
      });
      if (!settled) {
        onError("Paid on-chain, but we couldn't save it. Open the claim link and contact support if it stays unpaid.");
      }
      onPaid(paidClaim.id);
    } catch (e: unknown) {
      setStatus("idle");
      const nested = e && typeof e === "object" && "error" in e && e.error && typeof e.error === "object" && "message" in e.error
        ? String((e.error as { message?: unknown }).message ?? "")
        : "";
      const msg = (e instanceof Error ? e.message : "") || nested;
      if (/reject|denied|cancel/i.test(msg)) return;
      const shown = /^unexpected error$/i.test(msg)
        ? "Your wallet couldn't sign this payment. Try again. The amount to approve is the total on the button, including the small privacy fee."
        : msg;
      onError(shown && shown.length < 240 ? shown : "Payment failed. Please try again.");
    }
  };

  // The wallet modal only select()s a wallet; drive connect() and then the payment from here so
  // picking a wallet is the only extra step.
  useEffect(() => {
    if (!pendingAutoPay) return;
    if (connected && publicKey && signTransaction) {
      setPendingAutoPay(false);
      void pay(publicKey.toBase58(), signTransaction, signAllTransactions);
    } else if (wallet && !connecting && !connected) {
      connect().catch(() => {
        setPendingAutoPay(false);
        setStatus("idle");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoPay, connected, publicKey, signTransaction, wallet, connecting]);

  useEffect(() => {
    if (pendingAutoPay && !walletModalVisible && !wallet && !connecting && !connected) {
      setPendingAutoPay(false);
      setStatus("idle");
    }
  }, [pendingAutoPay, walletModalVisible, wallet, connecting, connected]);

  const total = isPrivate ? totalWithMagicBlockPrivateFee(amountUsd) + platformFeeUsd : amountUsd + platformFeeUsd;
  const busy = status !== "idle";
  const label =
    blocker ??
    (status === "connecting"
      ? "Connect your wallet…"
      : status === "creating" || status === "building"
        ? "Preparing…"
        : status === "awaiting_signature"
          ? "Confirm in your wallet…"
          : status === "broadcasting"
            ? "Sending…"
            : status === "confirming"
              ? "Confirming payment…"
              : connected
                ? `Pay $${total.toFixed(2)}${isPrivate ? " privately" : ""}`
                : `Connect wallet & pay $${total.toFixed(2)}`);

  return (
    <>
      {renderButton({
        onClick: () => {
          if (blocker || busy) return;
          if (connected && publicKey && signTransaction) {
            void pay(publicKey.toBase58(), signTransaction, signAllTransactions);
          } else {
            setStatus("connecting");
            setPendingAutoPay(true);
            setVisible(true);
          }
        },
        disabled: !!blocker || busy,
        loading: busy,
        label,
      })}
      {botCheckReady && !skipBotCheck && (
        <Turnstile
          siteKey={TURNSTILE_SITE_KEY}
          onSuccess={setTurnstileToken}
          onExpire={() => setTurnstileToken(null)}
          onError={(code) => console.error("[Turnstile] error:", code)}
          options={TURNSTILE_OPTIONS}
          className="fixed bottom-4 right-4 z-50"
        />
      )}
    </>
  );
}

export function GuestSendPayButton(props: Props) {
  return (
    <SolanaWalletConnectProvider rpcUrl={getSolanaHttpRpc()}>
      <Inner {...props} />
    </SolanaWalletConnectProvider>
  );
}
