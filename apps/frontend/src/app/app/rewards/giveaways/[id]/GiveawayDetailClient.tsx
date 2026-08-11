"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, Trash2, Download, Pencil, ShieldCheck, ExternalLink } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
// Mirrors giveaways-public.controller.ts's ENTRIES_VISIBLE_STATUSES — the entry list (and
// therefore the winners list) only exists server-side once entries have closed.
const ENTRIES_VISIBLE_STATUSES = ["ENTRIES_CLOSED", "DRAWING", "WINNERS_SELECTED", "PAYOUT_IN_PROGRESS", "COMPLETED"];
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

/** x_retweet/x_like/x_comment/x_bookmark on the same tweet render as one grouped card instead of
 *  four separate ones — matches how a creator set it up in the wizard ("engage with a post" with
 *  a few actions checked) and lets one click verify everything at once. Retweet already covers
 *  quote-tweets server-side (x-verification.service.ts unions retweeters + quote authors). */
const ENGAGE_TASK_TYPES = new Set(["x_retweet", "x_like", "x_comment", "x_bookmark"]);
const ENGAGE_ACTION_LABELS: Record<string, string> = {
  x_retweet: "Retweet / Quote",
  x_like: "Like",
  x_comment: "Comment",
  x_bookmark: "Bookmark",
};

/** Turns a task's raw target (a handle for x_follow, a bare or full URL for everything else) into a real clickable href. */
function taskTargetHref(target: string, taskType: string): string {
  const t = target.trim();
  if (taskType === "x_follow") return `https://x.com/${t.replace(/^@/, "")}`;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** On its own line (not squeezed inline with the action list above) so it doesn't blend into
 *  body text, colored with the app's accent instead of a bordered pill. */
const taskLinkClass = "block text-base font-normal mt-2 truncate hover:underline underline-offset-2 transition-opacity hover:opacity-80";

// Same translucent-white style as the "Connect X" / "Connect Telegram" buttons on the /c/[id]
// claim page, used for every task-verification action so it doesn't compete visually with the
// accent-colored prize amounts and links on this page.
const taskActionButtonClass = "rounded-lg bg-white/10 text-white text-base font-semibold hover:bg-white/20 transition-colors disabled:opacity-40 disabled:hover:bg-white/10";

type PublicTask = { id: string; task_type: string; config: { target?: string; comment_requirement?: string; instructions?: string; title?: string }; order_index: number; verification_mode: string };
type TaskDisplayGroup = { kind: "engage"; target: string; tasks: PublicTask[] } | { kind: "single"; task: PublicTask };

/** Groups engage-type tasks that share the same tweet URL into one display card; everything else
 *  (follow, telegram, discord, visit link, custom) stays one card per task, unchanged. */
function groupTasksForDisplay(tasks: PublicTask[]): TaskDisplayGroup[] {
  const groups: TaskDisplayGroup[] = [];
  const engageByTarget = new Map<string, TaskDisplayGroup & { kind: "engage" }>();
  for (const task of tasks) {
    if (ENGAGE_TASK_TYPES.has(task.task_type)) {
      const target = task.config?.target ?? "";
      let group = engageByTarget.get(target);
      if (!group) {
        group = { kind: "engage", target, tasks: [] };
        engageByTarget.set(target, group);
        groups.push(group);
      }
      group.tasks.push(task);
    } else {
      groups.push({ kind: "single", task });
    }
  }
  return groups;
}

interface PublicGiveaway {
  id: string; title: string; description: string | null; logo_url: string | null; project_name: string | null; short_id: string | null;
  winner_count: number; selection_mode: string; prize_amount_usd: string; entries_close_at: string;
  eligibility: { min_followers?: number; min_account_age_days?: number };
  status: string; burner_address: string | null; mint: string | null; is_devnet: boolean;
  funding_required_usd: string | null; funding_confirmed_usd: string; entry_count: number;
  entry_snapshot_hash: string | null; vrf_randomness: string | null; vrf_fulfilled_at: string | null; vrf_request_slot: number | null; draw_request_pda: string | null;
  is_official: boolean;
  tasks: PublicTask[];
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
  const [showProofModal, setShowProofModal] = useState(false);

  // Proof-of-completion inputs for require_proof tasks, keyed by task id — a link/text field plus
  // an uploaded (server-compressed) screenshot, either of which is enough to submit.
  const [taskProofText, setTaskProofText] = useState<Record<string, string>>({});
  const [taskProofImageUrl, setTaskProofImageUrl] = useState<Record<string, string>>({});
  const [uploadingTaskProof, setUploadingTaskProof] = useState<Record<string, boolean>>({});

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
      const res = await fetch(`${BACKEND_URL}/giveaways/public/${id}`, { cache: "no-store" });
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

  // Public entry list (X handle + status) — becomes available once entries close (backend gates
  // this the same way, `visible: false` before that). Doubles as the "provably fair" recompute
  // data (id + status for every entrant) and the source for the winners list below.
  const { data: publicEntries } = useQuery({
    queryKey: ["giveaway-public-entries", resolvedId],
    queryFn: async (): Promise<{ visible: boolean; entries: Array<{ id: string; x_handle: string; status: string }> }> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/public/${resolvedId}/entries`);
      if (!res.ok) return { visible: false, entries: [] };
      return res.json();
    },
    enabled: Boolean(giveaway && ENTRIES_VISIBLE_STATUSES.includes(giveaway.status)),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const winnerHandles = (publicEntries?.entries ?? []).filter((e) => e.status === "winner").map((e) => e.x_handle);

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

  const submitTask = useCallback(async (taskId: string, submission: { text?: string; proofImageUrl?: string }): Promise<string | undefined> => {
    const submission_data =
      submission.text || submission.proofImageUrl
        ? { proof: submission.text || undefined, proof_image_url: submission.proofImageUrl || undefined }
        : undefined;
    const res = await fetch(`${BACKEND_URL}/giveaways/${resolvedId}/tasks/${taskId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
      body: JSON.stringify({ submission_data }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message || "Failed to submit task");
    return body?.completion?.verification_status;
  }, [resolvedId, getAccessToken]);

  const uploadTaskProof = useCallback(async (taskId: string, file: File) => {
    setUploadingTaskProof((prev) => ({ ...prev, [taskId]: true }));
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/giveaways/upload-proof", {
        method: "POST",
        headers: await authHeaders(getAccessToken),
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Failed to upload image");
      setTaskProofImageUrl((prev) => ({ ...prev, [taskId]: body.proof_url }));
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not upload screenshot", description: err.message });
    } finally {
      setUploadingTaskProof((prev) => ({ ...prev, [taskId]: false }));
    }
  }, [toast, getAccessToken]);

  const markTaskDone = useCallback(async (taskId: string, submission: { text?: string; proofImageUrl?: string } = {}) => {
    try {
      const status = await submitTask(taskId, submission);
      // X tasks (retweet/like/follow/comment) verify instantly against the live X API — give
      // accurate feedback right away instead of a generic "marked done" that implies it's still pending.
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
  }, [submitTask, toast, refetchEntry]);

  // One click verifies every action in an "engage with a post" group at once (retweet/quote,
  // comment, like, bookmark) instead of requiring a separate click per action — like and bookmark
  // are trusted on click server-side (X has no API to check either), retweet/comment are checked
  // for real against the live X API.
  const verifyEngageGroup = useCallback(async (taskIds: string[]) => {
    try {
      const results = await Promise.all(taskIds.map((taskId) => submitTask(taskId, {})));
      const allVerified = results.every((s) => s === "auto_verified" || s === "verified");
      const anyRejected = results.some((s) => s === "rejected");
      if (allVerified) {
        toast({ title: "Verified! ✅", description: "Confirmed on X." });
      } else if (anyRejected) {
        toast({ variant: "destructive", title: "Not fully verified", description: "We couldn't confirm everything on X yet — make sure you've actually done it, then try again." });
      } else {
        toast({ title: "Marked done" });
      }
      refetchEntry();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not submit task", description: err.message });
    }
  }, [submitTask, toast, refetchEntry]);

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
  const giveawayEnded = giveaway.status !== "OPEN";
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

          <Dialog open={showProofModal} onOpenChange={setShowProofModal}>
            <DialogContent className="border-white/10 bg-[#0f0f12] text-white sm:max-w-md max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-[#FF7A2A]" />
                  Provably fair draw
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  The winner was picked by a random number from Solana, not by Loofta.
                  {giveaway.is_devnet && " This giveaway ran on Solana devnet, a test network, so it's not a real-money draw."}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 mt-2">
                {giveaway.draw_request_pda && (
                  <p className="flex items-center gap-1.5 text-base text-emerald-400">
                    <Check className="w-4 h-4 shrink-0" /> Verified live against Solana when this page loaded
                  </p>
                )}

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-base font-medium text-white mb-1">Randomness</p>
                  <p className="text-base text-slate-400 mb-2">
                    Generated by MagicBlock VRF once entries closed, then used to rank and pick every winner.
                  </p>
                  <p className="text-base font-mono text-slate-300 break-all bg-black/30 rounded-lg px-2.5 py-2 mb-2">
                    {giveaway.vrf_randomness}
                  </p>
                  <p className="text-base text-slate-500">
                    Fulfilled {giveaway.vrf_fulfilled_at && new Date(giveaway.vrf_fulfilled_at).toLocaleString()}
                  </p>
                </div>

                {giveaway.draw_request_pda && (
                  <p className="text-base text-slate-500">
                    Technical:{" "}
                    <a
                      href={`https://explorer.solana.com/address/${giveaway.draw_request_pda}/anchor-account${giveaway.is_devnet ? "?cluster=devnet" : ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#FF7A2A] hover:underline underline-offset-2"
                    >
                      view raw account on Solana Explorer <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </p>
                )}
              </div>
            </DialogContent>
          </Dialog>

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
            {/* draw_request_pda is only ever set by the backend once it has independently
                confirmed the on-chain account exists AND matches the stored randomness — never
                gate this on vrf_fulfilled_at/vrf_randomness alone, since those columns can be
                populated by the legacy non-VRF fallback path too (see 2026-08-06 incident). */}
            {giveaway.draw_request_pda && (
              <button
                type="button"
                onClick={() => setShowProofModal(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-base font-medium border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all"
              >
                <ShieldCheck className="w-4 h-4" />
                View on-chain proof
              </button>
            )}
            {winnerHandles.length > 0 && (
              <div className="mt-3">
                <p className="text-base text-slate-400 mb-2">Winners</p>
                <div className="flex flex-wrap gap-2">
                  {winnerHandles.map((handle) => (
                    <a
                      key={handle}
                      href={`https://x.com/${handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                    >
                      @{handle}
                    </a>
                  ))}
                </div>
              </div>
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
              {groupTasksForDisplay(giveaway.tasks).map((group) => {
                if (group.kind === "engage") {
                  const subStatuses = group.tasks.map(
                    (t) => myEntry?.completions.find((c) => c.giveaway_task_id === t.id)?.verification_status ?? "pending",
                  );
                  const allVerified = subStatuses.every((s) => s === "verified" || s === "auto_verified");
                  const anyRejected = subStatuses.some((s) => s === "rejected");
                  const instructions = group.tasks.find((t) => t.config?.comment_requirement || t.config?.instructions);
                  const groupTaskIds = group.tasks.map((t) => t.id);
                  return (
                    <div key={`engage-${group.target}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-base font-medium text-white">Engage with the post</p>
                      <p className="text-base mt-1.5">
                        {group.tasks.map((t, i) => {
                          const status = myEntry?.completions.find((c) => c.giveaway_task_id === t.id)?.verification_status;
                          const ok = status === "verified" || status === "auto_verified";
                          return (
                            <span key={t.id} className="inline-flex items-center">
                              {i > 0 && <span className="text-slate-500 font-semibold mx-1">+</span>}
                              <span className={`inline-flex items-center gap-1 ${ok ? "text-emerald-400" : "text-slate-400"}`}>
                                {ok && <Check className="w-3.5 h-3.5" />}
                                {ENGAGE_ACTION_LABELS[t.task_type] ?? t.task_type}
                              </span>
                            </span>
                          );
                        })}
                      </p>
                      {group.target && (
                        <a href={taskTargetHref(group.target, "x_retweet")} target="_blank" rel="noopener noreferrer" className={taskLinkClass} style={{ color: ACCENT }}>
                          {group.target}
                        </a>
                      )}
                      {instructions && (
                        <p className="text-base text-slate-300 mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <span className="font-medium text-white">Instructions: </span>
                          {instructions.config.comment_requirement || instructions.config.instructions}
                        </p>
                      )}
                      {myEntry && (
                        <div className="mt-3">
                          {allVerified ? (
                            <span className="inline-flex items-center gap-1 text-base font-medium text-emerald-400"><Check className="w-3.5 h-3.5" /> Verified</span>
                          ) : anyRejected ? (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-base font-medium text-red-400">Not fully verified</span>
                              {!giveawayEnded && (
                                <button
                                  type="button"
                                  onClick={() => verifyEngageGroup(groupTaskIds)}
                                  className={`shrink-0 px-4 py-2.5 ${taskActionButtonClass}`}
                                >
                                  Try again
                                </button>
                              )}
                            </div>
                          ) : giveawayEnded ? (
                            <span className="text-base font-medium text-slate-500">Giveaway ended, can no longer be verified</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => verifyEngageGroup(groupTaskIds)}
                              className={`w-full px-4 py-2.5 ${taskActionButtonClass}`}
                            >
                              Verify
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }

                const task = group.task;
                const completion = myEntry?.completions.find((c) => c.giveaway_task_id === task.id);
                const verified = completion?.verification_status === "verified" || completion?.verification_status === "auto_verified";
                const rejected = completion?.verification_status === "rejected";
                const isCustom = task.task_type === "custom";
                const hasStructuredTitle = isCustom && typeof task.config?.title === "string" && task.config.title.trim().length > 0;
                const title = hasStructuredTitle ? (task.config.title as string) : (TASK_TYPE_LABELS[task.task_type] ?? task.task_type);
                // Legacy custom tasks (created before config.title existed) stored a free-text
                // description in `target` — that's not a real URL, so render it as plain text
                // instead of a broken link. New-format custom tasks (with a title) use `target`
                // as the actual accompanying link.
                const showTargetAsLink = task.config?.target && (!isCustom || hasStructuredTitle);
                const showTargetAsText = isCustom && !hasStructuredTitle && task.config?.target;
                return (
                  <div key={task.order_index} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-base font-medium text-white">{title}</p>
                    {showTargetAsLink && (
                      <a href={taskTargetHref(task.config.target as string, task.task_type)} target="_blank" rel="noopener noreferrer" className={taskLinkClass} style={{ color: ACCENT }}>
                        {task.config.target}
                      </a>
                    )}
                    {showTargetAsText && (
                      <p className="text-base text-slate-300 mt-1.5">{task.config.target}</p>
                    )}
                    {(task.config?.comment_requirement || task.config?.instructions) && (
                      <p className="text-base text-slate-300 mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                        <span className="font-medium text-white">Instructions: </span>
                        {task.config.comment_requirement || task.config.instructions}
                      </p>
                    )}
                    {myEntry && (() => {
                      const requiresProof = !!task.config?.require_proof && task.verification_mode !== "auto_api";
                      const proofText = taskProofText[task.id] ?? "";
                      const proofImageUrl = taskProofImageUrl[task.id];
                      const uploadingProof = !!uploadingTaskProof[task.id];
                      const canSubmitProof = !!(proofText.trim() || proofImageUrl);
                      return (
                        <div className="mt-3">
                          {verified ? (
                            <span className="inline-flex items-center gap-1 text-base font-medium text-emerald-400"><Check className="w-3.5 h-3.5" /> Verified</span>
                          ) : completion?.submission_data && !rejected ? (
                            <span className="text-base font-medium text-amber-400">Pending review</span>
                          ) : giveawayEnded ? (
                            <span className="text-base font-medium text-slate-500">Giveaway ended, can no longer be verified</span>
                          ) : requiresProof ? (
                            <div className="space-y-2">
                              {rejected && <p className="text-base font-medium text-red-400">Rejected — submit new proof to try again</p>}
                              <input
                                type="text"
                                value={proofText}
                                onChange={(e) => setTaskProofText((prev) => ({ ...prev, [task.id]: e.target.value }))}
                                placeholder="Link to your proof (optional if you upload a screenshot)"
                                className="w-full text-base rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF7A2A]/40"
                              />
                              <div className="flex items-center gap-3">
                                <label className="cursor-pointer text-base font-medium border border-white/10 text-slate-300 hover:bg-white/[0.06] transition-all rounded-lg px-3 py-2">
                                  {uploadingProof ? "Uploading…" : proofImageUrl ? "Change screenshot" : "Upload screenshot"}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    disabled={uploadingProof}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) uploadTaskProof(task.id, file);
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                                {proofImageUrl && (
                                  <Image src={proofImageUrl} alt="" width={36} height={36} className="rounded-lg object-cover border border-white/10 shrink-0" />
                                )}
                              </div>
                              <button
                                type="button"
                                disabled={!canSubmitProof || uploadingProof}
                                onClick={() => markTaskDone(task.id, { text: proofText.trim(), proofImageUrl })}
                                className={`w-full px-4 py-2.5 ${taskActionButtonClass}`}
                              >
                                Submit for review
                              </button>
                            </div>
                          ) : rejected ? (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-base font-medium text-red-400">Rejected</span>
                              <button
                                type="button"
                                onClick={() => markTaskDone(task.id)}
                                className="shrink-0 text-base font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all rounded-lg px-4 py-2.5"
                              >
                                Try again
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => markTaskDone(task.id)}
                              className="w-full text-base font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all rounded-lg px-4 py-2.5"
                            >
                              {task.verification_mode === "auto_api" ? "Verify" : "Mark done"}
                            </button>
                          )}
                        </div>
                      );
                    })()}
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
