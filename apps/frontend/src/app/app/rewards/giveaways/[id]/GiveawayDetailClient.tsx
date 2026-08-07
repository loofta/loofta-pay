"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, Trash2, Download, Pencil } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy, useLinkAccount } from "@privy-io/react-auth";
import { useWallets, useSignTransaction } from "@privy-io/react-auth/solana";
import { Connection, SendTransactionError } from "@solana/web3.js";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore } from "@/store/auth";
import { useSolanaPayment } from "@/hooks/useSolanaPayment";
import { useSolPrice } from "@/hooks/useSolPrice";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { InsufficientBalanceCard } from "@/components/app/InsufficientBalanceCard";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { PrivacyConfettiBurst } from "@/components/PrivacyConfettiBurst";
import { PrivacyGlyph } from "@/components/PrivacyGlyph";
import { ShareLinkMenu } from "@/components/ShareLinkMenu";
import { getRpcForMode, getRpcFallbackForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";
import { getEphemeralRpcForMode } from "@/lib/per/constants";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { privatePayErrorMessageForUser } from "@/lib/privatePayUserError";
import { buildGiveawayFundingPrivateTransfer } from "@/services/api/claims";
import { FormattedText } from "@/components/FormattedText";
import posthog from "posthog-js";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
// Money-highlight accent (prize amounts), matching the browse-list card and this feature's other
// interactive accents — never used for buttons/badges, which use this app's established
// gradient/semantic tokens instead.
const ACCENT = "#FF7A2A";

// MagicBlock's own fee, same figures as backend MAGICBLOCK_VOLUME_FEE_BPS / MAGICBLOCK_GAS_SOL
// (apps/backend/src/common/magicblock-private-transfer.ts) — duplicated client-side only to
// show a fee estimate before the private transfer is actually built, same convention MultiSendFlow
// uses. No extra Loofta cut here — giveaway funding is a pure MagicBlock cost passthrough.
const MAGICBLOCK_VOLUME_FEE_BPS = 10;
const MAGICBLOCK_GAS_SOL = 0.002;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending review",
  REJECTED: "Rejected",
  PENDING_FUNDING: "Needs funding",
  FUNDED: "Funded",
  OPEN: "Funded",
  ENTRIES_CLOSED: "Entries closed",
  DRAWING: "Drawing winners",
  WINNERS_SELECTED: "Winners selected",
  PAYOUT_IN_PROGRESS: "Paying out",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  UNDERFUNDED_EXPIRED: "Expired — underfunded",
  REFUNDED: "Refunded",
};

function statusColor(status: string): string {
  if (status === "PENDING_APPROVAL") return "text-amber-400 bg-amber-500/10 border-amber-500/30";
  if (status === "REJECTED" || status === "UNDERFUNDED_EXPIRED" || status === "CANCELLED") return "text-red-400 bg-red-500/10 border-red-500/30";
  if (status === "PENDING_FUNDING") return "text-[#FF7A2A] bg-[#FF7A2A]/10 border-[#FF7A2A]/30";
  if (status === "OPEN" || status === "COMPLETED") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  return "text-slate-300 bg-white/[0.06] border-white/10";
}

const TASK_TYPE_LABELS: Record<string, string> = {
  x_follow: "Follow on X",
  x_retweet: "Retweet the post",
  x_like: "Like the post",
  x_comment: "Comment on the post",
  x_bookmark: "Bookmark the post",
  telegram_join: "Join Telegram",
  discord_join: "Join Discord",
  visit_link: "Visit the link",
  custom: "Custom task",
};

/** Turns a task's raw target (a handle for x_follow, a bare or full URL for everything else) into a real clickable href. */
function taskTargetHref(target: string, taskType: string): string {
  const t = target.trim();
  if (taskType === "x_follow") return `https://x.com/${t.replace(/^@/, "")}`;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

interface PublicGiveaway {
  id: string; title: string; description: string | null; logo_url: string | null; project_name: string | null; short_id: string | null;
  winner_count: number; selection_mode: string; prize_amount_usd: string; entries_close_at: string;
  eligibility: { min_followers?: number; min_account_age_days?: number };
  status: string; burner_address: string | null; mint: string | null; is_devnet: boolean;
  funding_required_usd: string | null; funding_confirmed_usd: string; entry_count: number;
  entry_snapshot_hash: string | null; vrf_randomness: string | null; vrf_fulfilled_at: string | null;
  is_official: boolean;
  tasks: Array<{ id: string; task_type: string; config: { target?: string; comment_requirement?: string; instructions?: string }; order_index: number; verification_mode: string }>;
}

interface TaskCompletion {
  id: string; giveaway_task_id: string; verification_status: string; submission_data: Record<string, unknown> | null;
}

interface MyEntry {
  id: string; status: string; payout_status: string | null; claim_payment_id: string | null;
  completions: TaskCompletion[];
}

async function authHeaders(getAccessToken: () => Promise<string | null>): Promise<Record<string, string>> {
  const token = await getAccessToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function GiveawayDetailClient({ id }: { id: string }) {
  const { authenticated, userId } = useAuth();
  const { getAccessToken, login, user } = usePrivy();
  // Entry requires a linked X account (backend checks followers/account-age off the linked
  // profile) — surface a "Connect X" action inline instead of only failing after the fact.
  const hasXLinked = !!(user as any)?.linkedAccounts?.some((a: any) =>
    ["twitter_oauth", "twitter_oauth2", "twitter", "x"].includes((a?.type ?? "").toLowerCase()),
  );
  const { linkTwitter } = useLinkAccount({});
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [downloadingImage, setDownloadingImage] = useState(false);

  // Funding — "Pay now" mirrors the app's existing send-payment/multi-send pattern instead of
  // asking the creator to copy a raw address into another wallet. Lives here (not on /manage) so
  // the creator can fund right where they see the giveaway's status, no extra click required.
  const networkMode = useAuthStore((s) => s.networkMode);
  const { wallets: solanaWallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const solanaPayment = useSolanaPayment();
  const solPriceUsd = useSolPrice();
  const [payPrivately, setPayPrivately] = useState(false);
  const [paying, setPaying] = useState(false);
  const [privacyBurstKey, setPrivacyBurstKey] = useState<number | null>(null);
  const handleTogglePayPrivately = useCallback((checked: boolean) => {
    setPayPrivately(checked);
    if (checked) setPrivacyBurstKey(Date.now());
  }, []);

  const { data: giveaway, isLoading, error, refetch } = useQuery({
    queryKey: ["giveaway-public", id],
    queryFn: async (): Promise<PublicGiveaway> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/public/${id}`);
      if (!res.ok) throw new Error("Giveaway not found");
      return res.json();
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  // The URL param may be either the real UUID or the short_id — every authenticated call below
  // needs the real UUID (short_id only means anything to the public find-by-either lookup), so
  // this resolves to giveaway.id once the public fetch above lands, falling back to the raw param
  // until then (a no-op fallback when the URL already had the real UUID).
  const resolvedId = giveaway?.id ?? id;

  // Landed on the long UUID (an old link, a bookmark, someone pasting the raw id) but a short_id
  // now exists — clean up the address bar to the canonical short link. replace (not push) so this
  // doesn't add a back-button entry; harmless no-op once the URL already matches.
  useEffect(() => {
    if (giveaway?.short_id && id !== giveaway.short_id) {
      router.replace(`/rewards/giveaways/${giveaway.short_id}`);
    }
  }, [giveaway?.short_id, id, router]);

  const { data: myEntry, refetch: refetchEntry } = useQuery({
    queryKey: ["giveaway-my-entry", resolvedId, userId],
    queryFn: async (): Promise<MyEntry | null> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${resolvedId}/my-entry`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) return null;
      const data = await res.json();
      return data.entry ?? null;
    },
    enabled: Boolean(authenticated && userId && giveaway),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const { data: isOwner } = useQuery({
    queryKey: ["giveaway-is-owner", resolvedId, userId],
    queryFn: async (): Promise<boolean> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${resolvedId}`, { headers: await authHeaders(getAccessToken) });
      return res.ok;
    },
    enabled: Boolean(authenticated && userId && giveaway),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Live on-chain balance check (re-checks and flips PENDING_FUNDING -> OPEN once fully funded) —
  // only the owner can call this endpoint, and only while funding is actually in progress.
  const { data: funding, refetch: refetchFunding } = useQuery({
    queryKey: ["giveaway-funding", resolvedId],
    queryFn: async () => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${resolvedId}/funding`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Failed to load funding status");
      return res.json();
    },
    enabled: Boolean(isOwner && authenticated && userId && giveaway?.status === "PENDING_FUNDING"),
    refetchInterval: 15_000,
  });

  const enter = useCallback(async () => {
    setEntering(true);
    setEnterError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${resolvedId}/entries`, {
        method: "POST",
        headers: await authHeaders(getAccessToken),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to enter giveaway");
      }
      toast({ title: "You're entered!", description: "Complete the tasks below before entries close." });
      if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
        posthog.capture("giveaway_entered", {
          selection_mode: giveaway?.selection_mode,
          task_count: giveaway?.tasks.length,
        });
      }
      refetchEntry();
    } catch (err: any) {
      setEnterError(err.message);
    } finally {
      setEntering(false);
    }
  }, [resolvedId, getAccessToken, toast, refetchEntry, giveaway]);

  const markTaskDone = useCallback(async (taskId: string, submissionText: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${resolvedId}/tasks/${taskId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
        body: JSON.stringify({ submission_data: submissionText ? { proof: submissionText } : undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message || "Failed to submit task");
      // X tasks (retweet/like/follow/comment) verify instantly against the live X API — give
      // accurate feedback right away instead of a generic "marked done" that implies it's still pending.
      const status = body?.completion?.verification_status;
      if (status === "auto_verified" || status === "verified") {
        toast({ title: "Verified! ✅", description: "Confirmed on X." });
      } else if (status === "rejected") {
        toast({ variant: "destructive", title: "Not verified", description: "We couldn't confirm this on X yet — make sure you've actually done it, then try again." });
      } else {
        toast({ title: "Task marked done" });
      }
      refetchEntry();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not submit task", description: err.message });
    }
  }, [resolvedId, getAccessToken, toast, refetchEntry]);

  const handleFund = useCallback(async (remainingUsd: number, burnerAddress: string) => {
    setPaying(true);
    try {
      if (payPrivately) {
        const senderAddress = solanaPayment.senderAddress;
        const wallet = solanaWallets?.find((w) => w.address === senderAddress);
        if (!senderAddress || !wallet) throw new Error("Embedded wallet not found. Try logging out and back in.");

        const accessToken = await getAccessToken();
        const cluster = networkMode === "mainnet" ? "mainnet" : "devnet";
        const txData = await buildGiveawayFundingPrivateTransfer(resolvedId, user?.id ?? "", senderAddress, accessToken, cluster, true);

        const rawTxBytes = Buffer.from(txData.transactionBase64, "base64");
        const chain = getPrivySolanaChainForMode(networkMode);
        const ephemeralRpc = getEphemeralRpcForMode(networkMode);
        const broadcastRpc = txData.sendTo === "ephemeral" ? ephemeralRpc : getRpcForMode(networkMode);
        const broadcastConn = new Connection(broadcastRpc, "confirmed");

        let signature: string;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const signedOutput = await (signTransaction as any)({
            transaction: rawTxBytes,
            wallet,
            chain,
            options: { uiOptions: { showWalletUIs: false } },
          });
          signature = await broadcastConn.sendRawTransaction(signedOutput.signedTransaction, { skipPreflight: true, maxRetries: 3 });
        } catch (e) {
          if (e instanceof SendTransactionError) {
            try { const logs = await e.getLogs(broadcastConn); console.error("[GiveawayFunding] broadcast failed:", logs); } catch { /* ignore */ }
            throw new Error(privatePayErrorMessageForUser(e.message, cluster));
          }
          if (e instanceof Error) throw new Error(privatePayErrorMessageForUser(e.message, cluster));
          throw e;
        }

        const fallbackRpcUrl = txData.sendTo === "ephemeral" ? null : getRpcFallbackForMode(networkMode);
        const fallbackConn = fallbackRpcUrl ? new Connection(fallbackRpcUrl, "confirmed") : undefined;
        try {
          await waitForSignatureConfirmation(broadcastConn, signature, 120_000, 1500, "giveawayFunding", fallbackConn);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (!(msg.includes("InstructionError") && msg.includes('"Custom":'))) throw e;
        }
      } else {
        await solanaPayment.makePayment({ amount: remainingUsd, recipientAddress: burnerAddress, giveawayId: resolvedId });
      }
      toast({ title: "Payment sent", description: "Confirming on-chain — this can take a few seconds." });
      await Promise.all([refetchFunding(), refetch()]);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Funding payment failed", description: err.message });
    } finally {
      setPaying(false);
    }
  }, [resolvedId, user?.id, getAccessToken, networkMode, payPrivately, solanaPayment, solanaWallets, signTransaction, toast, refetchFunding, refetch]);

  const deleteGiveaway = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${resolvedId}`, {
        method: "DELETE",
        headers: await authHeaders(getAccessToken),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to delete giveaway");
      }
      setShowDeleteConfirm(false);
      toast({ title: "Giveaway deleted" });
      queryClient.invalidateQueries({ queryKey: ["giveaways-mine"] });
      router.push("/rewards/giveaways/mine");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not delete giveaway", description: err.message });
    } finally {
      setDeleting(false);
    }
  }, [resolvedId, getAccessToken, toast, router, queryClient]);

  const downloadShareImage = useCallback(async () => {
    setDownloadingImage(true);
    try {
      // no-store: a browser that fetched this URL before the Cache-Control fix (previously
      // immutable, max-age=31536000) would otherwise keep serving that stale cached response
      // forever, regardless of any server-side fix — this forces a real network hit every time.
      const res = await fetch(`/api/giveaways/${id}/og`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to generate image");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${(giveaway?.title || "giveaway").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not download image", description: err.message });
    } finally {
      setDownloadingImage(false);
    }
  }, [id, giveaway?.title, toast]);

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24 animate-pulse space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-32" />
        </div>
      </div>
    );
  }
  if (error || !giveaway) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <p className="text-red-400 text-base">Giveaway not found</p>
          </div>
        </div>
      </div>
    );
  }

  const fundingPct = giveaway.funding_required_usd
    ? Math.min(100, Math.round((Number(giveaway.funding_confirmed_usd) / Number(giveaway.funding_required_usd)) * 100))
    : 0;
  const canEnter = giveaway.status === "OPEN" && !myEntry;
  const canShare = giveaway.status !== "REJECTED" && giveaway.status !== "CANCELLED";
  // Matches the current environment (localhost in dev, pay.loofta.xyz in prod) instead of a
  // hardcoded production URL — a hardcoded one made ShareLinkMenu's OG pre-warm fetch cross-origin
  // when running locally, which CSP's connect-src correctly blocked (same convention as the claim
  // page's window.location.origin usage). SSR-safe fallback for the brief pre-hydration render.
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "https://pay.loofta.xyz";
  // Prefer the short_id for anything user-facing/shareable — much shorter than the raw UUID —
  // falling back to the real id for older rows created before short_id existed.
  const shareId = giveaway?.short_id ?? giveaway?.id ?? id;
  const giveawayUrl = `${siteUrl}/rewards/giveaways/${shareId}`;

  return (
    <>
      <div className="bg-[#0f0f12]">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-2 flex items-center justify-between">
          <Link href="/rewards/giveaways" className="inline-flex items-center gap-1.5 text-base text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
            <span>Back to giveaways</span>
          </Link>
          {isOwner && (
            <Link href={`/rewards/giveaways/${resolvedId}/manage`} className="text-base font-medium text-slate-300 hover:text-white transition-colors">
              Manage →
            </Link>
          )}
        </div>
      </div>

      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1.5 min-w-0">
              {giveaway.is_official ? (
                <>
                  <Image src="/loofta_icon_magic.png" alt="" width={16} height={16} className="rounded-full shrink-0" />
                  <span className="text-sm font-medium text-slate-400 truncate">Loofta</span>
                </>
              ) : (giveaway.logo_url || giveaway.project_name) ? (
                <>
                  {giveaway.logo_url && (
                    <Image src={giveaway.logo_url} alt="" width={16} height={16} className="rounded-full object-cover shrink-0" />
                  )}
                  {giveaway.project_name && <span className="text-sm font-medium text-slate-400 truncate">{giveaway.project_name}</span>}
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${statusColor(giveaway.status)}`}>
                {STATUS_LABELS[giveaway.status] ?? giveaway.status.replace(/_/g, " ")}
              </span>
              {giveaway.is_devnet && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border bg-white/[0.06] text-slate-300 border-white/10">Devnet</span>
              )}
              {isOwner && giveaway.status === "PENDING_APPROVAL" && (
                <Link
                  href={`/rewards/giveaways/${resolvedId}/edit`}
                  aria-label="Edit giveaway"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </Link>
              )}
              {isOwner && (giveaway.status === "PENDING_APPROVAL" || giveaway.status === "PENDING_FUNDING") && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  aria-label="Delete giveaway"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <AlertDialogContent className="[&_.text-gray-900]:!text-white [&_.text-muted-foreground]:!text-slate-300 [&_.border]:!border-white/10 bg-[#0f0f12] border-white/10">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Delete this giveaway?</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-300">
                  {giveaway.status === "PENDING_FUNDING"
                    ? "Any USDC already sent to the burner will be refunded to your wallet. This can't be undone."
                    : "This can't be undone."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-white !text-gray-900 border border-white/20 hover:bg-gray-100">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); deleteGiveaway(); }}
                  disabled={deleting}
                  className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <h1 className="text-2xl font-medium text-white mb-2">{giveaway.title}</h1>
          {giveaway.description && <FormattedText text={giveaway.description} className="text-base text-slate-300 mb-5 leading-relaxed" />}

          {canShare && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
              <ShareLinkMenu
                url={giveawayUrl}
                title={giveaway.title}
                text={`$${giveaway.prize_amount_usd} × ${giveaway.winner_count} winner${giveaway.winner_count === 1 ? "" : "s"} — enter "${giveaway.title}" on Loofta 🎁`}
                ogUrl={`${siteUrl}/api/giveaways/${shareId}/og`}
                triggerLabel="Share"
                triggerClassName="h-11 w-full"
              />
              <button
                type="button"
                onClick={downloadShareImage}
                disabled={downloadingImage}
                className="h-11 w-full flex items-center justify-center gap-2 rounded-xl border border-white/10 text-slate-300 font-semibold hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
              >
                {downloadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>Download</span>
              </button>
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-5">
            <div className="flex items-end justify-between mb-1">
              <p className="text-base font-semibold uppercase tracking-wider" style={{ color: `${ACCENT}99` }}>Prize per winner</p>
              <p className="text-base text-slate-500">{giveaway.entry_count} entered</p>
            </div>
            <p className="text-3xl font-medium" style={{ color: ACCENT }}>${giveaway.prize_amount_usd} × {giveaway.winner_count}</p>
            <p className="text-base text-slate-500 mt-2">
              Closes {new Date(giveaway.entries_close_at).toLocaleString()} ·{" "}
              {giveaway.selection_mode === "random" ? "Random draw" : giveaway.selection_mode === "first_come" ? "First come, first serve" : "Picked by creator"}
            </p>
            {(giveaway.status === "PENDING_FUNDING" || giveaway.status === "FUNDED") && giveaway.funding_required_usd && (
              <div className="mt-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-base text-slate-400">Funding: ${giveaway.funding_confirmed_usd} / ${giveaway.funding_required_usd}</span>
                  <span className="text-base text-slate-400">{fundingPct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-[#FF1301] to-[#EAB308]"
                    style={{ width: `${fundingPct}%` }}
                  />
                </div>
              </div>
            )}
            {giveaway.vrf_fulfilled_at && giveaway.vrf_randomness && (
              <p className="text-base text-slate-500 mt-3 break-all">
                Draw proof: randomness <span className="font-mono">{giveaway.vrf_randomness.slice(0, 16)}…</span>, snapshot <span className="font-mono">{giveaway.entry_snapshot_hash?.slice(0, 16)}…</span>
              </p>
            )}
          </div>

          {isOwner && giveaway.status === "PENDING_FUNDING" && giveaway.burner_address && (() => {
            const requiredUsd = Number(giveaway.funding_required_usd ?? 0);
            const confirmedUsd = Number(funding?.fundingConfirmedUsd ?? giveaway.funding_confirmed_usd ?? 0);
            const remainingUsd = Math.max(0, requiredUsd - confirmedUsd);

            // Client-side estimate only (used for display before the tx is actually built) — same
            // approach MultiSendFlow uses for its private-mode fee preview.
            const netUnits = Math.round(remainingUsd * 1_000_000);
            const grossUnits = netUnits > 0 ? Math.ceil((netUnits * 10_000) / (10_000 - MAGICBLOCK_VOLUME_FEE_BPS)) : 0;
            const bpsFeeUsdc = (grossUnits - netUnits) / 1_000_000;
            const flatFeeUsdc = MAGICBLOCK_GAS_SOL * solPriceUsd;
            const privateFeeUsdc = bpsFeeUsdc + flatFeeUsdc;
            const totalDueUsdc = payPrivately ? remainingUsd + privateFeeUsdc : remainingUsd;

            const insufficientBalance = !solanaPayment.isBalanceLoading && !solanaPayment.hasEnoughBalance(totalDueUsdc);

            if (remainingUsd <= 0) {
              return (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 mb-5 text-center">
                  <p className="font-semibold text-lg text-emerald-400">Funded! ✅</p>
                  <p className="text-base text-slate-300 mt-1">
                    ${confirmedUsd.toFixed(2)} of ${requiredUsd.toFixed(2)} confirmed — this giveaway is about to open for entries.
                  </p>
                </div>
              );
            }

            return (
              <div className="relative mb-5">
                {privacyBurstKey != null && <PrivacyConfettiBurst key={privacyBurstKey} onDone={() => setPrivacyBurstKey(null)} />}
                {payPrivately && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10 select-none [filter:drop-shadow(0_2px_5px_rgba(0,0,0,0.6))]">
                    <PrivacyGlyph size={24} opacity={1} className="text-slate-300" />
                  </div>
                )}
                <div className={`rounded-2xl border p-4 space-y-3 transition-colors ${payPrivately ? "border-white/15 bg-black/40" : "border-white/10 bg-white/5"}`}>
                  <p className="text-base font-medium text-slate-400 uppercase tracking-widest">Fund this giveaway</p>
                  <p className="text-base text-slate-300">
                    <span className="font-semibold text-white">${remainingUsd.toFixed(2)} USDC</span> left to fund
                    {confirmedUsd > 0 && <span className="text-slate-500"> · ${confirmedUsd.toFixed(2)} of ${requiredUsd.toFixed(2)} confirmed</span>}
                  </p>

                  <IncognitoModeToggle
                    checked={payPrivately}
                    onCheckedChange={handleTogglePayPrivately}
                    onLabel="Pay privately"
                    offLabel="Pay privately"
                  />
                  <p className="text-base text-slate-400">
                    {payPrivately ? `+$${privateFeeUsdc.toFixed(2)} fees (MagicBlock) · $${totalDueUsdc.toFixed(2)} total` : "Normal funding is a plain on-chain transfer, free of charge."}
                  </p>

                  {insufficientBalance ? (
                    <InsufficientBalanceCard balanceUSD={solanaPayment.balanceUSD} neededUSD={totalDueUsdc} showFeesLabel={payPrivately} />
                  ) : (
                    <GradientActionButton
                      disabled={paying || remainingUsd <= 0}
                      loading={paying}
                      loadingText="Paying…"
                      onClick={() => handleFund(remainingUsd, giveaway.burner_address!)}
                    >
                      Pay ${totalDueUsdc.toFixed(2)} now
                    </GradientActionButton>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-5">
            <p className="text-base font-medium text-slate-400 uppercase tracking-widest mb-2">Tasks</p>
            <div className="space-y-2">
              {giveaway.tasks.map((task) => {
                const completion = myEntry?.completions.find((c) => c.giveaway_task_id === task.id);
                const verified = completion?.verification_status === "verified" || completion?.verification_status === "auto_verified";
                const rejected = completion?.verification_status === "rejected";
                return (
                  <div key={task.order_index} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-base font-medium text-white">{TASK_TYPE_LABELS[task.task_type] ?? task.task_type}</p>
                        {task.config?.target && (
                          <a
                            href={taskTargetHref(task.config.target, task.task_type)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-base text-sky-400 hover:text-sky-300 underline underline-offset-2 truncate"
                          >
                            {task.config.target}
                          </a>
                        )}
                        {(task.config?.comment_requirement || task.config?.instructions) && (
                          <p className="text-base text-slate-300 mt-0.5">
                            {task.config.comment_requirement || task.config.instructions}
                          </p>
                        )}
                      </div>
                      {myEntry && (
                        verified ? (
                          <span className="shrink-0 inline-flex items-center gap-1 text-base font-medium text-emerald-400"><Check className="w-3.5 h-3.5" /> Verified</span>
                        ) : rejected ? (
                          <div className="shrink-0 flex flex-col items-end gap-1">
                            <span className="text-base font-medium text-red-400">Rejected</span>
                            <button
                              type="button"
                              onClick={() => markTaskDone(task.id, "")}
                              className="text-base font-medium border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all rounded-lg px-2.5 py-1"
                            >
                              Try again
                            </button>
                          </div>
                        ) : completion?.submission_data ? (
                          <span className="shrink-0 text-base font-medium text-amber-400">Pending review</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => markTaskDone(task.id, "")}
                            className="shrink-0 text-base font-medium border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all rounded-lg px-2.5 py-1"
                          >
                            {task.verification_mode === "auto_api" ? "Verify" : "Mark done"}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {(giveaway.eligibility?.min_followers || giveaway.eligibility?.min_account_age_days) && (
            <p className="text-base text-slate-500 mb-3">
              To enter: linked X account
              {giveaway.eligibility?.min_followers ? `, ${giveaway.eligibility.min_followers}+ followers` : ""}
              {giveaway.eligibility?.min_account_age_days ? `, account ${giveaway.eligibility.min_account_age_days}+ days old` : ""}
            </p>
          )}

          {!authenticated ? (
            // Every giveaway requires a linked X account to enter (see eligibility text above) —
            // sign in with X directly instead of offering methods that would just dead-end at a
            // second "Connect X" prompt right after.
            <GradientActionButton onClick={() => login({ loginMethods: ["twitter"], disableSignup: false })}>
              Sign in with X to enter
            </GradientActionButton>
          ) : canEnter && !hasXLinked ? (
            <GradientActionButton onClick={() => linkTwitter()}>
              Connect X to enter
            </GradientActionButton>
          ) : canEnter ? (
            <>
              <GradientActionButton onClick={enter} disabled={entering} loading={entering} loadingText="Entering…">
                Enter giveaway
              </GradientActionButton>
              {enterError && (
                <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                  <p className="text-base font-medium text-red-400">Could not enter</p>
                  <p className="text-base text-slate-400 mt-0.5">{enterError}</p>
                </div>
              )}
            </>
          ) : myEntry?.status === "winner" && myEntry.claim_payment_id ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
              <p className="font-semibold text-lg mb-1 text-emerald-400">You won!</p>
              <p className="text-base text-slate-300 mb-3">Claim your prize below — you can choose to claim it publicly or privately.</p>
              <GradientActionButton onClick={() => router.push(`/c/${myEntry.claim_payment_id}`)}>
                Claim your prize
              </GradientActionButton>
            </div>
          ) : myEntry?.status === "winner" ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
              <p className="font-semibold text-lg text-emerald-400">You won! Your claim link is being prepared — check back shortly.</p>
            </div>
          ) : myEntry ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
              <p className="text-base text-slate-400">You&apos;re entered — complete your tasks above before entries close.</p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
