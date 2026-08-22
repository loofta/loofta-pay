'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useWallets as useSolanaWallets,
  useSignTransaction as usePrivySolanaSignTransaction,
} from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { useAuthStore } from "@/store/auth";
import { useMultiSendStore, type MultiSendRow, type MultiSendLink } from "@/store/multiSend";
import { getRpcForMode, getRpcFallbackForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";
import { getEphemeralRpcForMode } from "@/lib/per/constants";
import {
  createMultiPayments,
  buildMultiSend,
  buildMultiSendFunding,
  confirmMultiSendFunding,
  multiConfirm,
  type MultiSendRecipient,
  type MultiSendLinkItem,
  type MultiCreateResult,
  type MultiSendResult,
} from "@/services/api/sendPayment";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { useSolanaPayment } from "@/hooks/useSolanaPayment";
import { InsufficientBalanceCard } from "@/components/app/InsufficientBalanceCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { PlusIcon, XIcon, CheckCircle2, Check, Copy, ExternalLink, Loader2, ArrowLeft, UploadCloud, FileDown, AlertCircle, User, Mail, ChevronDown } from "lucide-react";
import { MessageInput } from "@/components/MessageInput";
import { ShareLinkMenu } from "@/components/ShareLinkMenu";
import { SocialPlatformIcon, type SocialIconPlatform } from "@/components/SocialPlatformIcon";
import { TELEGRAM_SEND_ENABLED } from "@/lib/socialPlatforms";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { PrivacyConfettiBurst } from "@/components/PrivacyConfettiBurst";
import { useSolPrice } from "@/hooks/useSolPrice";
import type { MultiSendRecipientType } from "@/store/multiSend";
import posthog from "posthog-js";

// Multi-recipient send: re-enabled 2026-08-22 for manual devnet verification of the redesign
// (per-batch throwaway burner instead of a shared hub, row-level idempotent fan-out, per-recipient
// fees). The original shared-hub design had no per-sender isolation, which allowed both a
// fund-drain exploit and separate race-driven double-payments to real recipients (both discovered
// and remediated 2026-08-19) — do not re-disable by reverting this flag alone if a new issue is
// found; the underlying design changed. Backend endpoints are gated independently in
// send-payment.controller.ts — this is the UI-side counterpart.
const MULTI_SEND_DISABLED = false;

// MagicBlock's flat relay fee, in SOL — same figure as backend MAGICBLOCK_GAS_SOL
// (apps/backend/src/common/magicblock-private-transfer.ts). Duplicated rather than shared
// per this codebase's existing convention for small cross-app constants.
const MAGICBLOCK_GAS_SOL = 0.002;
// MagicBlock's own volume fee + Loofta's cut on a private multi-send recipient's own fan-out
// leg — same figures as backend MAGICBLOCK_VOLUME_FEE_BPS + SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS.
// Each recipient is charged this exactly (no batch discount), so this is also the correct
// per-row estimate shown in the review list, not just the total.
const MULTI_SEND_TOTAL_BPS = 20;

type ConfirmFeeData = {
  senderWallet: string;
  multiSendBatchId: string;
  paymentIds: string[];
  links: MultiSendLinkItem[];
  totalAmountUsdc: number;
  totalFeeUsdc: number;
};

// "idle" = on the form. "review" = review screen shown, no modal open.
// All other phases = review screen shown + modal open.
type SendPhase =
  | { kind: "idle" }
  | { kind: "review" }
  | { kind: "creating" }
  | { kind: "building"; index: number; total: number }
  | { kind: "awaiting_signature" }
  | { kind: "broadcasting"; index: number; total: number }
  | { kind: "done"; recipientCount: number; totalUsdc: number; links: MultiSendLinkItem[]; failedCount?: number }
  | { kind: "error"; message: string; retry?: ConfirmFeeData };

const SETTLEMENT_PHASES = ["creating", "building", "awaiting_signature", "broadcasting", "error"] as const;
const BUSY_PHASES = ["creating", "building", "awaiting_signature", "broadcasting"];

function looksLikeEmail(s: string): boolean {
  return s.includes("@") && /.+@.+\..+/.test(s.trim());
}

function inferType(s: string): "email" | "username" {
  return looksLikeEmail(s) ? "email" : "username";
}

const RECIPIENT_TYPE_OPTIONS: { id: MultiSendRecipientType; label: string; icon: "user" | "mail" | SocialIconPlatform }[] = [
  { id: "username", label: "Username", icon: "user" },
  { id: "email", label: "Email", icon: "mail" },
  { id: "twitter", label: "Twitter", icon: "twitter" },
  { id: "discord", label: "Discord", icon: "discord" },
  { id: "github", label: "GitHub", icon: "github" },
  // Telegram login is currently broken in production — hidden from this picker until fixed.
  ...(TELEGRAM_SEND_ENABLED ? [{ id: "telegram" as const, label: "Telegram", icon: "telegram" as const }] : []),
];

function RecipientTypeIcon({ icon, className }: { icon: "user" | "mail" | SocialIconPlatform; className?: string }) {
  if (icon === "user") return <User className={className} />;
  if (icon === "mail") return <Mail className={className} />;
  return <SocialPlatformIcon platform={icon} className={className} />;
}

const EXAMPLE_CSV = `recipient,amount,message
alice@email.com,100,Thanks for the work!
bob_username,50,Invoice #1234
TELEGRAM:@carol_tg,200,Great job this month
TWITTER:@diana,75,`;

const VALID_PREFIX_TYPES = new Set(RECIPIENT_TYPE_OPTIONS.map((o) => o.id as string));

/**
 * Lets a pasted/CSV recipient explicitly declare its platform (e.g. "TELEGRAM:@handle",
 * "EMAIL:email@email.com") instead of relying on inferType's email-vs-username guess — the only
 * way to reach twitter/discord/github/telegram from bulk paste, since inferType can't distinguish
 * those from a plain username.
 */
function parseRecipientWithPrefix(raw: string): { type: MultiSendRecipientType | null; value: string } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^([a-z]+)\s*:\s*(.+)$/i);
  if (m) {
    const candidate = m[1].toLowerCase();
    if (VALID_PREFIX_TYPES.has(candidate)) {
      return { type: candidate as MultiSendRecipientType, value: m[2].trim() };
    }
  }
  return { type: null, value: trimmed };
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; }
    else if (line.startsWith(delimiter, i) && !inQuotes) { result.push(current); current = ""; i += delimiter.length - 1; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

function parseCSV(text: string): { rows: MultiSendRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  const newRows: MultiSendRow[] = [];
  const firstLine = lines[0]?.toLowerCase() ?? "";
  const hasHeader = /^(recipient|email|username|to)/.test(firstLine);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const sample = dataLines[0] ?? "";
  const delimiter = (sample.match(/\t/g) ?? []).length >= (sample.match(/,/g) ?? []).length ? "\t" : ",";

  for (let i = 0; i < dataLines.length; i++) {
    const parts = parseCSVLine(dataLines[i], delimiter);
    const { type: recipientType, value: recipientRaw } = parseRecipientWithPrefix(parts[0] ?? "");
    const recipient = recipientRaw.replace(/^@/, "");
    const amountStr = parts[1]?.trim() ?? "";
    const message = parts[2]?.trim() ?? "";

    if (!recipient) { errors.push(`Row ${i + 1}: recipient is empty`); continue; }
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) { errors.push(`Row ${i + 1}: amount must be greater than $0`); continue; }
    newRows.push({
      id: `ms-csv-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
      recipient,
      amount: String(amount),
      message,
      ...(recipientType ? { recipientType } : {}),
    });
  }
  return { rows: newRows, errors };
}

function newRow(): MultiSendRow {
  return { id: `ms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, recipient: "", amount: "100", message: "", recipientType: "email" };
}

function defaultRows(): MultiSendRow[] {
  return [
    { id: "ms-row-0", recipient: "", amount: "100", message: "", recipientType: "email" },
    { id: "ms-row-1", recipient: "", amount: "100", message: "", recipientType: "email" },
  ];
}

export interface MultiSendFlowProps {
  onBack: () => void;
}

export function MultiSendFlow({ onBack }: MultiSendFlowProps) {
  const { rows, reviewPending, completedLinks, hydrated, setRows, setReviewPending, setCompletedLinks, clear } = useMultiSendStore();
  // MagicBlock's flat relay fee is 0.002 SOL, not a fixed USD amount — priced live so the
  // estimate doesn't drift stale as SOL/USD moves (was hardcoded to $0.20, i.e. SOL≈$100).
  const solPriceUsd = useSolPrice();
  const magicblockFlatFeeUsdc = MAGICBLOCK_GAS_SOL * solPriceUsd;
  const [phase, setPhase] = useState<SendPhase>({ kind: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [copiedList, setCopiedList] = useState(false);
  // Default OFF (normal/public) — matches the single-send claim page's incognito toggle default.
  // Private costs a MagicBlock fee per recipient; normal is a free plain on-chain transfer.
  const [sendPrivately, setSendPrivately] = useState(false);
  // Same "entering incognito mode" confetti moment as the single-send claim page — non-null key
  // mounts one <PrivacyConfettiBurst>; it clears itself via onDone.
  const [privacyBurstKey, setPrivacyBurstKey] = useState<number | null>(null);
  const handleToggleSendPrivately = (checked: boolean) => {
    setSendPrivately(checked);
    if (checked) setPrivacyBurstKey(Date.now());
  };
  const [showAllRecipients, setShowAllRecipients] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live-validates as the user types/edits, instead of only on the initial paste — lets them see
  // and fix a malformed line before anything is actually imported into the row list below.
  const { rows: pasteParsedRows, errors: pasteParsedErrors } = useMemo(
    () => (pasteText.trim() ? parseCSV(pasteText) : { rows: [] as MultiSendRow[], errors: [] as string[] }),
    [pasteText],
  );

  const { user, getAccessToken, login, authenticated } = usePrivy();
  const networkMode = useAuthStore((s) => s.networkMode);
  const { wallets: solanaWallets } = useSolanaWallets();
  const solanaPayment = useSolanaPayment({ enabled: reviewPending || phase.kind === "review" });
  const { signTransaction: privySolanaSignTransaction } = usePrivySolanaSignTransaction();
  const { toast } = useToast();

  const apiCluster = networkMode === "mainnet" ? "mainnet" : "devnet";

  useEffect(() => {
    if (phase.kind === "idle" || phase.kind === "review" || phase.kind === "done") {
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    }
  }, [phase.kind]);

  // Restore state after store rehydrates (survives page refresh)
  useEffect(() => {
    if (!hydrated) return;
    if (completedLinks && completedLinks.length > 0) {
      setPhase({
        kind: "done",
        recipientCount: completedLinks.length,
        totalUsdc: completedLinks.reduce((s, l) => s + parseFloat(l.amount), 0),
        links: completedLinks,
      });
    } else if (reviewPending) {
      setPhase((p) => p.kind === "idle" ? { kind: "review" } : p);
    }
  }, [hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  function downloadExample() {
    const blob = new Blob([EXAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "loofta-multisend-example.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Links don't carry recipient_type — only the rows the batch was built from do — so platform
   *  is recovered by zipping back to filledRows in submission order (same order links were
   *  created in, one per filled row). */
  function buildExportRows(links: MultiSendLinkItem[]) {
    return links.map((l, i) => ({
      recipient: l.recipient_identifier,
      platform: RECIPIENT_TYPE_OPTIONS.find((o) => o.id === filledRows[i]?.recipientType)?.label ?? "Username",
      amount: l.amount,
      link: l.link,
    }));
  }

  /** Export the just-created links so the sender can hand them out from a spreadsheet — one
   *  recipient (handle + platform + amount + link) per line, same CSV-download pattern as
   *  downloadExample above. */
  function exportLinks(links: MultiSendLinkItem[]) {
    const exportRows = buildExportRows(links);
    const csv = [
      "recipient,platform,amount,link",
      ...exportRows.map((r) => `${r.recipient},${r.platform},${r.amount},${r.link}`),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "loofta-multisend-links.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Same rows as exportLinks, copied to the clipboard as tab-separated text so it pastes
   *  cleanly into a spreadsheet without needing a file download. */
  async function copyLinksList(links: MultiSendLinkItem[]) {
    const exportRows = buildExportRows(links);
    const text = [
      "recipient\tplatform\tamount\tlink",
      ...exportRows.map((r) => `${r.recipient}\t${r.platform}\t${r.amount}\t${r.link}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedList(true);
      setTimeout(() => setCopiedList(false), 2000);
    } catch {
      toast({ variant: "destructive", title: "Copy failed" });
    }
  }

  function handleCSVFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { rows: newRows, errors } = parseCSV(text);
      setCsvErrors(errors);
      if (newRows.length > 0) {
        const capped = newRows.slice(0, 10);
        const padded = capped.length < 2 ? [...capped, ...defaultRows().slice(capped.length)] : capped;
        setRows(padded);
        if (newRows.length > 10) {
          setCsvErrors((prev) => [`Only the first 10 recipients were imported (max 10)`, ...prev]);
        }
      }
    };
    reader.readAsText(file);
  }

  function importPastedRows() {
    if (pasteParsedRows.length === 0) return;
    const capped = pasteParsedRows.slice(0, 10);
    const padded = capped.length < 2 ? [...capped, ...defaultRows().slice(capped.length)] : capped;
    setRows(padded);
    // Fully clean import (no skipped/malformed lines, nothing truncated) — collapse the panel
    // like before. Otherwise leave the text and its live error list in place so the user can fix
    // the remaining lines and click "Add" again, instead of the box silently vanishing or emptying.
    if (pasteParsedErrors.length === 0 && pasteParsedRows.length <= 10) {
      setShowPaste(false);
      setPasteText("");
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleCSVFile(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // See MULTI_SEND_DISABLED's doc comment above. Every hook above still runs normally (React
  // rules-of-hooks); only the interactive UI is swapped out.
  if (MULTI_SEND_DISABLED) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <p className="text-slate-100 text-xl font-semibold flex-1">Multi Send</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center space-y-3">
          <div className="text-4xl">🛠️</div>
          <p className="text-slate-100 text-lg font-semibold">Making Multi Send even better</p>
          <p className="text-slate-400 text-base max-w-xs mx-auto">
            We're polishing up the experience — check back soon. For now, send to one recipient at a time.
          </p>
        </div>
      </div>
    );
  }

  function addRow() {
    if (rows.length >= 10) return;
    setRows([...rows, newRow()]);
  }

  function removeRow(id: string) {
    if (rows.length <= 2) return;
    setRows(rows.filter((r) => r.id !== id));
  }

  function updateRow(id: string, field: keyof Omit<MultiSendRow, "id">, value: string) {
    setRows(rows.map((r) => r.id === id ? { ...r, [field]: value } : r));
  }

  const totalUsd = rows.reduce((sum, r) => {
    const n = parseFloat(r.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const MIN_TOTAL_AMOUNT = 5;

  const filledRows = rows.filter((r) => {
    const n = parseFloat(r.amount);
    return r.recipient.trim().length > 0 && Number.isFinite(n) && n > 0;
  });

  const filledTotal = filledRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const meetsMinTotal = filledTotal >= MIN_TOTAL_AMOUNT;

  const canReview = filledRows.length >= 2 && meetsMinTotal;

  const recipients: MultiSendRecipient[] = rows
    .filter((r) => r.recipient.trim().length > 0)
    .map((r) => {
      const cleanRecipient = r.recipient.trim().replace(/^@/, "").toLowerCase();
      return {
        amount: parseFloat(r.amount),
        recipient_type: r.recipientType ?? inferType(r.recipient),
        // "loo-" is a fixed prefix in the row UI when recipientType is "username" — the field only holds the suffix.
        recipient_identifier: r.recipientType === "username" ? `loo-${cleanRecipient}` : cleanRecipient,
        message: [r.message.trim(), r.gif].filter(Boolean).join(" ").trim() || undefined,
      };
    });

  async function createPayments(senderWallet: string) {
    console.info(`[MultiSend] createPayments senderWallet=${senderWallet.slice(0, 8)}… recipients=${recipients.length}`);
    setPhase({ kind: "creating" });
    try {
      const accessToken = await getAccessToken();
      if (!user?.id) throw new Error("Not authenticated");

      const result: MultiCreateResult = await createMultiPayments(
        { recipients, sender_wallet: senderWallet, cluster: apiCluster },
        user.id,
        accessToken,
      );

      console.info(`[MultiSend] payment records created batch=${result.multi_send_batch_id} payment_ids=${result.payment_ids.join(",")}`);
      await executePayment({
        senderWallet,
        multiSendBatchId: result.multi_send_batch_id,
        paymentIds: result.payment_ids,
        links: result.links,
        totalAmountUsdc: result.total_amount_usdc,
        totalFeeUsdc: result.total_fee_usdc,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.info(`[MultiSend] createPayments failed: ${msg}`);
      setPhase({ kind: "error", message: msg });
      toast({ variant: "destructive", title: "Failed to create payments", description: msg });
    }
  }

  /**
   * Normal (non-private) path — one combined plain SPL transaction for every recipient, no
   * MagicBlock fee. Unlike createPayments+executePayment (which create rows first, then build
   * per-recipient), buildMultiSend creates the payment rows AND returns the single unsigned tx in
   * one call — there's no separate "rebuild for existing rows" endpoint, so a failed broadcast
   * here has no retry (see the error phase below); the user goes Back and hits "Pay now" again.
   */
  async function executePublicPayment(senderWallet: string) {
    console.info(`[MultiSend] executePublicPayment senderWallet=${senderWallet.slice(0, 8)}… recipients=${recipients.length}`);
    setPhase({ kind: "creating" });
    try {
      const accessToken = await getAccessToken();
      if (!user?.id) throw new Error("Not authenticated");

      const result: MultiSendResult = await buildMultiSend(
        { recipients, sender_wallet: senderWallet, cluster: apiCluster },
        user.id,
        accessToken,
      );
      console.info(`[MultiSend] public tx built payment_ids=${result.payment_ids.join(",")}`);

      const cluster = networkMode === "mainnet" ? "mainnet" : "devnet";
      const chain = getPrivySolanaChainForMode(networkMode);
      const wallet = solanaWallets.find((w) => w.address === senderWallet) ?? solanaWallets[0];
      if (!wallet) throw new Error("Loofta wallet not found. Try logging out and back in.");

      setPhase({ kind: "awaiting_signature" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signedOutput = await (privySolanaSignTransaction as any)({
        transaction: Buffer.from(result.transactionBase64, "base64") as Uint8Array,
        wallet,
        chain,
        options: { uiOptions: { showWalletUIs: false } },
      });
      const signedBytes: Uint8Array = signedOutput.signedTransaction;

      setPhase({ kind: "broadcasting", index: 1, total: 1 });
      const sig = await broadcastAndWaitForHash(signedBytes, "combined", "base", cluster);
      // Pass the real backend-computed value, not a hardcoded 0 — the backend charges a small
      // ATA-rent recovery fee whenever this send created new recipient token accounts (see
      // ata-rent-recovery.ts), so it's not always exactly free even on this "no platform fee" path.
      multiConfirm(result.payment_ids, user.id, accessToken, sig, result.networkFeeUsdc ?? 0).catch(() => { });

      console.info(`[MultiSend] public send done payment_ids=${result.payment_ids.join(",")}`);
      setCompletedLinks(result.links as MultiSendLink[]);
      setReviewPending(false);
      setRows(defaultRows());
      if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
        posthog.capture("multi_send_completed", {
          recipient_count: result.recipientCount,
          total_usdc: result.totalAmountUsdc,
          is_private: false,
        });
      }
      setPhase({
        kind: "done",
        recipientCount: result.recipientCount,
        totalUsdc: result.totalAmountUsdc,
        links: result.links,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.info(`[MultiSend] executePublicPayment failed: ${msg}`);
      setPhase({ kind: "error", message: msg });
      toast({ variant: "destructive", title: "Multi-send failed", description: msg });
    }
  }

  async function broadcastAndWaitForHash(
    signedBytes: Uint8Array,
    paymentId: string,
    sendTo: string,
    cluster: "mainnet" | "devnet",
  ): Promise<string> {
    console.info(`[MultiSend] broadcasting paymentId=${paymentId} sendTo=${sendTo} cluster=${cluster}`);
    const rpc = sendTo === "ephemeral" ? getEphemeralRpcForMode(cluster) : getRpcForMode(cluster);
    const broadcastConn = new Connection(rpc, "confirmed");
    const sig = await broadcastConn.sendRawTransaction(signedBytes, { skipPreflight: true, maxRetries: 3 });
    console.info(`[MultiSend] broadcast ok sig=${sig.slice(0, 12)}… paymentId=${paymentId}`);
    // Base layer: fall back to the secondary RPC provider (Alchemy/Helius) in case the
    // primary hasn't indexed the signature yet. Ephemeral: fall back to the base RPC.
    const fallbackRpcUrl = sendTo === "ephemeral" ? getRpcForMode(cluster) : getRpcFallbackForMode(cluster);
    const fallbackConn = fallbackRpcUrl ? new Connection(fallbackRpcUrl, "confirmed") : undefined;
    // 120s for both — matches usePerPrivateTransfer's single-payment timeout. MagicBlock
    // base-layer confirmation is a normal-speed tx (the 1-10min privacy delay applies to the
    // crank's separate background settlement, not to this signature landing).
    const timeoutMs = 120_000;
    try {
      await waitForSignatureConfirmation(broadcastConn, sig, timeoutMs, 1500, "multiSend", fallbackConn);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // MagicBlock private transfers can land on-chain with a Custom error code (e.g. Custom:1)
      // even though the payment was processed — MagicBlock commits the transfer on HTTP 200
      // and its crank delivers regardless of auxiliary instruction failures.
      // Re-throw only for non-Custom errors (timeout, wrong cluster, etc.).
      if (msg.includes("InstructionError") && msg.includes('"Custom":')) {
        console.warn(`[MultiSend] MagicBlock custom error (non-fatal, payment delivered): ${msg} sig=${sig.slice(0, 12)}…`);
      } else {
        throw e;
      }
    }
    console.info(`[MultiSend] confirmed sig=${sig.slice(0, 12)}… paymentId=${paymentId}`);
    return sig;
  }

  /**
   * Private path: ONE MagicBlock private transfer, sender wallet → this batch's fresh, single-
   * use burner (never the shared fee-payer wallet) — the sender's only signature for the whole
   * batch. The backend fans out to each recipient with its own individual MagicBlock private
   * transfer afterward (see confirmMultiSendFunding / runMultiSendFanOut on the backend) —
   * recipients aren't funded yet by the time this resolves, only the batch burner is. Every row
   * in the batch flips OPEN → IN_FLIGHT as soon as this broadcasts (backend-side), so the
   * recipient's claim page shows "waiting for funds," never a stale "pay this" prompt.
   */
  async function executePayment(confirmState: ConfirmFeeData) {
    console.info(`[MultiSend] executePayment batch=${confirmState.multiSendBatchId} paymentIds=${confirmState.paymentIds.join(",")}`);
    const { senderWallet, multiSendBatchId, links } = confirmState;

    try {
      const accessToken = await getAccessToken();
      if (!user?.id) throw new Error("Not authenticated");

      const cluster = networkMode === "mainnet" ? "mainnet" : "devnet";
      const chain = getPrivySolanaChainForMode(networkMode);
      const wallet = solanaWallets.find((w) => w.address === senderWallet) ?? solanaWallets[0];
      if (!wallet) throw new Error("Loofta wallet not found. Try logging out and back in.");

      setPhase({ kind: "building", index: 1, total: 1 });
      const fundingTx = await buildMultiSendFunding(
        { multi_send_batch_id: multiSendBatchId, sender_wallet: senderWallet, cluster: apiCluster },
        user.id,
        accessToken,
      );

      setPhase({ kind: "awaiting_signature" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signedOutput = await (privySolanaSignTransaction as any)({
        transaction: Buffer.from(fundingTx.transactionBase64, "base64") as Uint8Array,
        wallet,
        chain,
        options: { uiOptions: { showWalletUIs: false } },
      });
      const signedBytes: Uint8Array = signedOutput.signedTransaction;

      setPhase({ kind: "broadcasting", index: 1, total: 1 });
      const sig = await broadcastAndWaitForHash(signedBytes, "funding", fundingTx.sendTo, cluster);

      // Fire-and-forget — the backend flips this batch's rows to IN_FLIGHT and fans out to each
      // recipient from the batch burner in the background, resolving well after this call returns.
      confirmMultiSendFunding(multiSendBatchId, user.id, accessToken, sig).catch(() => { });

      console.info(`[MultiSend] funding transfer broadcast batch=${multiSendBatchId} sig=${sig.slice(0, 12)}…`);
      setCompletedLinks(links as MultiSendLink[]);
      setReviewPending(false);
      setRows(defaultRows());
      if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
        posthog.capture("multi_send_completed", {
          recipient_count: confirmState.paymentIds.length,
          total_usdc: confirmState.totalAmountUsdc,
          is_private: true,
        });
      }
      setPhase({
        kind: "done",
        recipientCount: confirmState.paymentIds.length,
        totalUsdc: confirmState.totalAmountUsdc,
        links,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.info(`[MultiSend] executePayment failed: ${msg}`);
      setPhase({ kind: "error", message: msg, retry: confirmState });
      toast({ variant: "destructive", title: "Multi-send failed", description: msg });
    }
  }

  function handleRequestPayment() {
    if (!authenticated) {
      login({ loginMethods: ["twitter", "email", "discord", "github"], disableSignup: false });
      return;
    }
    if (filledRows.length < 2) {
      toast({ variant: "destructive", title: "At least 2 recipients required", description: "Fill in at least 2 recipients to use multi-send." });
      return;
    }
    if (!meetsMinTotal) {
      toast({ variant: "destructive", title: "Minimum $5 total", description: `Total across all recipients must be at least $${MIN_TOTAL_AMOUNT}.` });
      return;
    }
    setReviewPending(true);
    setPhase({ kind: "review" });
  }

  async function handlePayNow() {
    const senderAddress = deriveSolanaEmbeddedAddress(user);
    const wallet = solanaWallets.find((w) => w.address === senderAddress) ?? solanaWallets[0];
    if (!wallet) {
      toast({ variant: "destructive", title: "No Loofta wallet", description: "Your embedded wallet was not found. Try logging out and back in." });
      return;
    }
    if (sendPrivately) {
      await createPayments(wallet.address);
    } else {
      await executePublicPayment(wallet.address);
    }
  }

  // ── Done screen ────────────────────────────────────────────────────────────
  if (phase.kind === "done") {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <CheckCircle2 className="text-green-400 w-6 h-6 shrink-0" />
          <p className="text-white text-xl font-semibold">
            {phase.failedCount ? `${phase.recipientCount} of ${phase.recipientCount + phase.failedCount} payments sent` : "All payments sent!"}
          </p>
        </div>
        <p className="text-slate-400 text-base">
          ${phase.totalUsdc.toFixed(2)} USDC sent to {phase.recipientCount} recipient{phase.recipientCount > 1 ? "s" : ""}.
        </p>
        {sendPrivately && (
          <p className="text-slate-400 text-base">
            Sent privately — recipients are funded in the background and can take up to 15 minutes to receive their funds.
          </p>
        )}
        {!!phase.failedCount && (
          <p className="text-amber-400 text-base">
            {phase.failedCount} payment{phase.failedCount > 1 ? "s" : ""} failed to confirm on-chain. The funds were not deducted for those.
          </p>
        )}

        <div className="space-y-2">
          {phase.links.map((item) => {
            const copyLink = async () => {
              try {
                await navigator.clipboard.writeText(item.link);
                setCopiedLinkId(item.id);
                setTimeout(() => setCopiedLinkId((cur) => (cur === item.id ? null : cur)), 2000);
              } catch {
                toast({ variant: "destructive", title: "Copy failed" });
              }
            };
            return (
              <div key={item.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-white text-lg font-medium truncate">{item.recipient_identifier}</p>
                    <p className="text-slate-400 text-base">${parseFloat(item.amount).toFixed(2)} USDC</p>
                  </div>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                    title="Open payment"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
                <div className="flex gap-2">
                  <div className="flex flex-1 gap-2 min-w-0">
                    <Input
                      readOnly
                      value={item.link}
                      className="font-mono text-xs flex-1 min-w-0 bg-white/5 border-white/10 text-white"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={copyLink}
                      className="shrink-0 bg-transparent border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
                    >
                      {copiedLinkId === item.id ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <ShareLinkMenu
                    url={item.link}
                    title="Payment sent"
                    text={`$${parseFloat(item.amount).toFixed(2)} sent to ${item.recipient_identifier} via Loofta.`}
                    variant="subtle"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => exportLinks(phase.links)}
            className="flex-1 h-11 rounded-xl text-base font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all flex items-center justify-center gap-1.5"
          >
            <FileDown className="w-4 h-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => copyLinksList(phase.links)}
            className="flex-1 h-11 rounded-xl text-base font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all flex items-center justify-center gap-1.5"
          >
            {copiedList ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            {copiedList ? "Copied!" : "Copy list"}
          </button>
        </div>

        <Button
          onClick={() => {
            clear();
            setPhase({ kind: "idle" });
          }}
          className="w-full h-11 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white font-semibold hover:opacity-90"
        >
          Create a new payment
        </Button>
      </div>
    );
  }

  // ── Review screen (shown for review phase + all settlement sub-phases) ─────
  // reviewPending persists across refresh; the settlement modal opens on top.
  if (reviewPending || phase.kind === "review") {
    const validRows = rows.filter((r) => {
      const n = parseFloat(r.amount);
      return r.recipient.trim().length > 0 && Number.isFinite(n) && n > 0;
    });
    const reviewTotal = validRows.reduce((s, r) => s + parseFloat(r.amount), 0);
    const phaseKind = phase.kind as string;
    const settlementModalOpen = (SETTLEMENT_PHASES as readonly string[]).includes(phaseKind);
    const isBusy = BUSY_PHASES.includes(phaseKind);

    function closeSettlementModal() {
      if (!isBusy) {
        setPhase({ kind: "review" });
      }
    }

    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        {privacyBurstKey != null && <PrivacyConfettiBurst key={privacyBurstKey} onDone={() => setPrivacyBurstKey(null)} />}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setReviewPending(false);
              setPhase({ kind: "idle" });
            }}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Back to form"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <p className="text-white text-xl font-semibold">Review Payment</p>
        </div>

        {(() => {
          const VISIBLE_LIMIT = 4;
          const visibleRows = showAllRecipients ? validRows : validRows.slice(0, VISIBLE_LIMIT);
          const hiddenCount = validRows.length - visibleRows.length;
          // Each recipient's own fee — MagicBlock's own bps + Loofta's cut, computed per row, no
          // batch discount (the private path is now one funding transfer into a throwaway burner
          // that then sends each recipient their own individual MagicBlock private transfer, each
          // charged exactly like a normal single private payment). Matches backend
          // singlePaymentFeeUnits exactly — same MULTI_SEND_TOTAL_BPS, same flat relay fee.
          const flatFeeUnits = Math.round(magicblockFlatFeeUsdc * 1_000_000);
          const perRowFeeUsdc = new Map<string, number>();
          let totalFeeUnits = 0;
          for (const r of validRows) {
            const net = Math.round(parseFloat(r.amount) * 1_000_000);
            if (net <= 0) { perRowFeeUsdc.set(r.id, 0); continue; }
            const gross = Math.ceil((net * 10_000) / (10_000 - MULTI_SEND_TOTAL_BPS));
            const feeUnits = (gross - net) + flatFeeUnits;
            perRowFeeUsdc.set(r.id, feeUnits / 1_000_000);
            totalFeeUnits += feeUnits;
          }
          const totalFee = totalFeeUnits / 1_000_000;
          const reviewTotalWithFees = sendPrivately ? reviewTotal + totalFee : reviewTotal;
          const hasEnough = solanaPayment.hasEnoughBalance(reviewTotalWithFees);
          const isBalanceBusy = solanaPayment.isBalanceLoading;

          return (
            <>
              <div className="space-y-1">
                {/* Header */}
                <div className="flex justify-between text-slate-400 text-base px-1 pb-1">
                  <span>Recipient</span>
                  <span>Amount</span>
                </div>
                {visibleRows.map((row, idx) => {
                  const amt = parseFloat(row.amount);
                  const rowFee = sendPrivately ? perRowFeeUsdc.get(row.id) ?? 0 : 0;
                  return (
                    <div
                      key={row.id}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 gap-2 ${
                        idx % 2 === 0 ? "bg-white/[0.03] border-white/5" : "bg-white/[0.08] border-white/10"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-slate-400 text-base">Recipient {idx + 1}</p>
                        <p className="text-white text-base font-medium truncate">
                          {row.recipient.trim().replace(/^@/, "")}
                        </p>
                        {row.message.trim() && (
                          <p className="text-slate-400 text-base truncate">{row.message.trim()}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-white text-base block">${amt.toFixed(2)}</span>
                        {sendPrivately && (
                          <span className="text-slate-400 text-base block">+${rowFee.toFixed(2)} fee</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecipients(true)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-base font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
                  >
                    <ChevronDown className="w-4 h-4" />
                    {hiddenCount} more recipient{hiddenCount !== 1 ? "s" : ""}
                  </button>
                )}
                {showAllRecipients && validRows.length > VISIBLE_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecipients(false)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-base font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
                  >
                    Show less
                  </button>
                )}
                {/* Total row */}
                <div className="flex justify-between items-center border-t border-white/10 px-3 pt-3 mt-1">
                  <span className="text-white font-semibold text-lg">{validRows.length} recipient{validRows.length !== 1 ? "s" : ""}</span>
                  <span className="flex gap-5 text-right shrink-0">
                    <span className="text-white font-semibold text-lg">${reviewTotal.toFixed(2)}</span>
                    <span className="text-slate-400 text-base">{sendPrivately ? `+$${totalFee.toFixed(2)} fees` : "no fees"}</span>
                  </span>
                </div>
              </div>

              <IncognitoModeToggle checked={sendPrivately} onCheckedChange={handleToggleSendPrivately} />

              <p className="text-slate-400 text-base">
                {sendPrivately
                  ? "Private hides these payments from public on-chain view. Fees are estimated, exact breakdown confirmed before payment."
                  : "Normal payments are a plain on-chain transfer, free of charge."}
              </p>

              {!isBalanceBusy && !hasEnough ? (
                <InsufficientBalanceCard
                  balanceUSD={solanaPayment.balanceUSD}
                  neededUSD={reviewTotalWithFees}
                />
              ) : (
                <Button
                  onClick={handlePayNow}
                  disabled={isBalanceBusy}
                  className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                >
                  {isBalanceBusy ? "Loading balance…" : "Pay now"}
                </Button>
              )}
            </>
          );
        })()}

        {/* Settlement modal: creating → building → signing → broadcasting → error */}
        <Dialog
          open={settlementModalOpen}
          onOpenChange={(open) => { if (!open) closeSettlementModal(); }}
        >
          <DialogContent
            className="sm:max-w-md p-8 border-white/10 bg-[#0f0f12] text-white [&_.text-gray-900]:!text-white [&_.text-muted-foreground]:!text-slate-400 [&_.bg-orange-100]:!bg-orange-500/20 [&_.text-orange-600]:!text-orange-300 [&_.bg-amber-50\/90]:!bg-amber-500/15 [&_.border-amber-200]:!border-amber-400/30 [&_.text-amber-950]:!text-amber-200"
            onPointerDownOutside={(e) => { if (isBusy) e.preventDefault(); }}
            onEscapeKeyDown={(e) => { if (isBusy) e.preventDefault(); }}
            aria-describedby={undefined}
          >
            {/* creating / building / awaiting_signature / broadcasting */}
            {(phase.kind === "creating" || phase.kind === "building" || phase.kind === "awaiting_signature" || phase.kind === "broadcasting") && (
              <>
                <DialogHeader className="flex flex-col items-center justify-center text-center space-y-0 pb-4 sm:text-center" aria-hidden>
                  <div className="mb-4 flex justify-center">
                    <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
                    </div>
                  </div>
                  <DialogTitle className="text-xl font-semibold text-gray-900 text-center">
                    {phase.kind === "creating" && "Preparing payments"}
                    {phase.kind === "building" && "Preparing your payment"}
                    {phase.kind === "awaiting_signature" && "Approve in your wallet"}
                    {phase.kind === "broadcasting" && "Sending payment"}
                  </DialogTitle>
                  <p className="pt-2 text-base text-center text-muted-foreground max-w-sm">
                    {phase.kind === "creating" &&
                      "Setting up transactions. Please keep this window open."}
                    {phase.kind === "building" && (
                      sendPrivately
                        ? "Building your funding transfer. Please keep this window open."
                        : "Building your combined transfer. Please keep this window open."
                    )}
                    {phase.kind === "awaiting_signature" && (
                      <>
                        One transaction {sendPrivately ? "funding a private payout to" : "sending to"}{" "}
                        <span className="font-medium text-orange-600">
                          {filledRows.length} recipient{filledRows.length === 1 ? "" : "s"}
                        </span>
                        . Do not close this tab until you finish signing.
                      </>
                    )}
                    {phase.kind === "broadcasting" && (
                      sendPrivately ? (
                        <>
                          Your funding transfer is broadcasting — this confirms right away. Recipients are then
                          paid out privately in the background — funds can take up to 15 minutes to land.
                        </>
                      ) : (
                        "Broadcasting your combined payment. This can take a moment."
                      )
                    )}
                  </p>
                </DialogHeader>
                <div className="rounded-lg border border-amber-200 bg-amber-50/90 p-3 text-center text-base text-amber-950">
                  Stay on this page until the payment completes.
                </div>
              </>
            )}

            {/* error */}
            {phase.kind === "error" && (
              <>
                <DialogTitle className="text-white text-lg font-semibold mb-1">Payment failed</DialogTitle>
                <p className="text-red-400 text-base pt-2">{phase.message}</p>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="ghost"
                    className="flex-1 text-slate-400 hover:text-white"
                    onClick={() => setPhase({ kind: "review" })}
                  >
                    Back
                  </Button>
                  {phase.retry && (
                    <Button
                      className="flex-1 bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white font-semibold hover:opacity-90"
                      onClick={() => executePayment(phase.retry!)}
                    >
                      Try again
                    </Button>
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-slate-400 hover:text-white transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <p className="text-white text-xl font-semibold flex-1">Multi Send</p>
        {process.env.NODE_ENV === "development" && (
          <button
            type="button"
            onClick={() => setPhase({
              kind: "done",
              recipientCount: 3,
              totalUsdc: 152,
              failedCount: 1,
              links: [
                { id: "dev-preview-1", link: `${window.location.origin}/app/c/dev-preview-1`, recipient_identifier: "alice_dev", amount: "100" },
                { id: "dev-preview-2", link: `${window.location.origin}/app/c/dev-preview-2`, recipient_identifier: "bob@example.com", amount: "50" },
                { id: "dev-preview-3", link: `${window.location.origin}/app/c/dev-preview-3`, recipient_identifier: "carol_dev", amount: "2" },
              ],
            })}
            className="text-amber-400 hover:text-amber-300 text-xs border border-amber-400/30 rounded-lg px-2 py-1 transition-colors"
            title="Dev only: preview the done screen with mock data"
          >
            Preview result
          </button>
        )}
      </div>

      {/* CSV import zone */}
      <div className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleCSVFile(f);
            e.target.value = "";
          }}
        />
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-all select-none ${
            isDragOver
              ? "border-orange-400/60 bg-orange-500/10"
              : "border-white/15 hover:border-white/30 hover:bg-white/5"
          }`}
        >
          <UploadCloud className={`w-6 h-6 mx-auto mb-2 transition-colors ${isDragOver ? "text-orange-400" : "text-slate-400"}`} />
          <p className="text-white text-base font-semibold">Import from CSV</p>
          <p className="text-slate-400 text-base mt-0.5">Drag & drop or click to browse</p>
          <p className="text-slate-400 text-base font-mono mt-2">recipient, amount, message</p>
          <p className="text-slate-500 text-base mt-1">
            Prefix a recipient to set its platform, e.g. TELEGRAM:@handle or EMAIL:name@email.com
          </p>
        </div>

        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={downloadExample}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-base transition-colors"
          >
            <FileDown className="w-3.5 h-3.5" />
            Download example
          </button>
          <span className="text-slate-500 text-base">·</span>
          <button
            type="button"
            onClick={() => { setShowPaste((v) => !v); setCsvErrors([]); }}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-base transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <rect x="5" y="1" width="9" height="12" rx="1.5" />
              <path d="M2 4v10a1.5 1.5 0 0 0 1.5 1.5H11" />
              <path d="M8 5h3M8 8h3M8 11h1" strokeLinecap="round" />
            </svg>
            {showPaste ? "Hide paste" : "Paste text"}
          </button>
        </div>

        {showPaste && (
          <div className="rounded-xl border border-white/15 bg-white/5 p-3 space-y-2">
            <p className="text-slate-400 text-base">Paste CSV or spreadsheet rows — comma or tab separated</p>
            <p className="text-slate-500 text-base -mt-1">
              Prefix a recipient to set its platform, e.g. TELEGRAM:@handle or EMAIL:name@email.com
            </p>
            <textarea
              autoFocus
              rows={5}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"alice@email.com, 100, Thanks!\nbob_username, 50\nTELEGRAM:@carol_tg, 200, Invoice #42"}
              className="w-full rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-slate-500 text-base font-mono p-2.5 resize-none focus:outline-none focus:border-white/30"
            />
            {pasteText.trim().length > 0 && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-base ${pasteParsedErrors.length > 0 ? "text-red-400" : "text-emerald-400"}`}>
                    {pasteParsedRows.length > 0
                      ? `${pasteParsedRows.length} recipient${pasteParsedRows.length === 1 ? "" : "s"} ready${
                          pasteParsedErrors.length > 0
                            ? `, ${pasteParsedErrors.length} row${pasteParsedErrors.length === 1 ? "" : "s"} need${pasteParsedErrors.length === 1 ? "s" : ""} fixing`
                            : ""
                        }`
                      : "No valid recipients yet"}
                  </p>
                  <button
                    type="button"
                    onClick={importPastedRows}
                    disabled={pasteParsedRows.length === 0}
                    className="shrink-0 h-9 px-3 rounded-lg text-base font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all disabled:opacity-40 disabled:pointer-events-none"
                  >
                    Add {pasteParsedRows.length || ""} recipient{pasteParsedRows.length === 1 ? "" : "s"}
                  </button>
                </div>
                {pasteParsedRows.length > 10 && (
                  <p className="text-slate-500 text-base flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Only the first 10 recipients will be imported (max 10) — the rest are ignored.
                  </p>
                )}
                {pasteParsedErrors.length > 0 && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 space-y-1">
                    {pasteParsedErrors.map((err, i) => (
                      <p key={i} className="text-red-400 text-base flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        {err}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {csvErrors.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 space-y-1">
            {csvErrors.map((err, i) => (
              <p key={i} className="text-red-400 text-base flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {err}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-white/15" />
        <span className="text-slate-300 text-base font-medium shrink-0">or add manually</span>
        <div className="h-px flex-1 bg-white/15" />
      </div>

      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div key={row.id} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 text-base font-semibold">Recipient {idx + 1}</span>
              {rows.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                  aria-label="Remove recipient"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div>
              <Label className="text-slate-400 text-base">To</Label>
              <div className="mt-1 flex gap-2">
                <Select
                  value={row.recipientType ?? "email"}
                  onValueChange={(v) => updateRow(row.id, "recipientType", v)}
                >
                  <SelectTrigger className="h-10 w-[150px] shrink-0 bg-white/5 border-white/10 text-white text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECIPIENT_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        <span className="flex items-center gap-2">
                          <RecipientTypeIcon icon={opt.icon} className="h-4 w-4 shrink-0" />
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative flex-1">
                  {row.recipientType === "username" && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white font-medium select-none pointer-events-none">
                      loo-
                    </span>
                  )}
                  <Input
                    value={row.recipient}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const cleaned = row.recipientType === "username"
                        ? raw.replace(/^loo-/, "").replace(/[^a-z0-9_-]/gi, "")
                        : raw;
                      updateRow(row.id, "recipient", cleaned);
                    }}
                    placeholder={
                      row.recipientType === "username"
                        ? "Loofta Username"
                        : row.recipientType === "email" || (!row.recipientType && looksLikeEmail(row.recipient))
                          ? "alice@email.com"
                          : "handle"
                    }
                    className={[
                      "h-10 bg-white/5 border-white/10 text-white placeholder:text-slate-400 text-base md:text-base",
                      row.recipientType === "username" ? "pl-10" : "",
                    ].join(" ")}
                  />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-slate-400 text-base">Amount (USD)</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={row.amount}
                onBeforeInput={(e) => {
                  const data = (e.nativeEvent as InputEvent).data;
                  if (data && /[^0-9]/.test(data)) e.preventDefault();
                }}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0-9]/g, "");
                  e.target.value = cleaned;
                  updateRow(row.id, "amount", cleaned);
                }}
                placeholder="100"
                className="mt-1 h-10 bg-white/5 border-white/10 text-white placeholder:text-slate-400 text-base md:text-base"
              />
            </div>

            <div>
              <Label className="text-slate-400 text-base">Message (optional)</Label>
              <MessageInput
                value={row.message}
                onChange={(v) => updateRow(row.id, "message", v)}
                gifUrl={row.gif ?? null}
                onGifChange={(url) => updateRow(row.id, "gif", url ?? "")}
                placeholder="Optional note"
                maxLength={500}
                className="mt-1 [&_input]:h-10 [&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_input]:placeholder:text-slate-400 [&_input]:text-base"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        {rows.length < 10 ? (
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-base font-medium transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            Add recipient
          </button>
        ) : <span />}
        {rows.some((r) => r.recipient.trim() || r.amount !== "100" || r.message.trim()) && (
          <button
            type="button"
            onClick={() => { setRows(defaultRows()); setCsvErrors([]); setShowPaste(false); }}
            className="text-slate-500 hover:text-red-400 text-base transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="flex items-center justify-between text-base text-slate-400 border-t border-white/10 pt-3">
        <span>{rows.length} recipient{rows.length > 1 ? "s" : ""}</span>
        <span className="text-white font-medium">${totalUsd.toFixed(2)} total</span>
      </div>

      {filledRows.length === 1 && (
        <p className="text-amber-400 text-base text-center">Multi-send requires at least 2 recipients</p>
      )}
      {filledRows.length >= 2 && !meetsMinTotal && (
        <p className="text-amber-400 text-base text-center">Total across recipients must be at least ${MIN_TOTAL_AMOUNT}</p>
      )}

      <Button
        onClick={!authenticated ? () => login({ loginMethods: ["twitter", "email", "discord", "github"], disableSignup: false }) : handleRequestPayment}
        disabled={authenticated && !canReview}
        className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
      >
        {!authenticated ? "Sign in to continue" : "Continue to pay"}
      </Button>

      <p className="text-slate-400 text-base text-center">
        All transfers are private MagicBlock payments. Each recipient gets their own payment link.
      </p>
    </div>
  );
}
