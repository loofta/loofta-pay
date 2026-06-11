"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { useToast } from "@/components/ui/use-toast";
import {
  Loader2, Play, Trash2, Zap, Check, X, RefreshCw,
  SlidersHorizontal, Target, SendHorizonal, ArrowLeft, Search,
  Mic2, Briefcase, Building2, ChevronDown, ChevronUp, MapPin, Users,
  Copy, MessageCircle, UserCheck, Activity, Square, CheckSquare2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProspectType   = "creator" | "freelancer" | "web3_project";
type ProspectStatus = "new" | "drafting" | "drafted" | "approved" | "rejected" | "sent" | "follow_pending";
type Filter         = "all" | "approved" | "sent" | "rejected";

type Prospect = {
  id: string;
  created_at: string;
  handle: string;
  bio: string;
  type: ProspectType;
  status: ProspectStatus;
  draft_message: string | null;
  final_message: string | null;
  qualified: boolean | null;
  qualification_reason: string | null;
  sent_at: string | null;
  sent_via: "dm" | "reply" | null;
  location: string | null;
  profile_image_url: string | null;
  followers_count: number | null;
  replied: boolean;
  followed: boolean;
};

type OutreachConfig = {
  product_pitch: string;
  message_tone: string;
  call_to_action: string;
  creator_pitch: string;
  freelancer_pitch: string;
  web3_project_pitch: string;
};

const DEFAULT_CONFIG: OutreachConfig = {
  product_pitch:
    "Loofta Pay - private payments on Solana. Pay or get paid in any token, recipient withdraws in whatever they want. The payment is private on-chain, so no one can trace the amount, the sender, or link it back to a wallet history.",
  message_tone:
    "casual, direct, peer-to-peer. Lisa is a founder reaching out, not a sales rep. Short sentences. No startup-speak.",
  call_to_action:
    "We're onboarding early users now - they get priority setup and direct support from me. End with a strong yes/no: 'want in?' or 'worth a chat?' Never say 'want to try it'.",
  creator_pitch:
    "Your sponsors can look up your wallet before they negotiate - they see every brand deal you've taken and how much you got paid. Loofta lets you get paid privately in any token, withdraw in whatever you want. Early users get priority onboarding and direct support. Close with urgency: 'spots are limited - want in?' or 'we're giving early users priority access - want in?'",
  freelancer_pitch:
    "When a client pays you on-chain, they can see your full income history - who else paid you, how much, every project. Loofta pays you privately in any token your client has. No forced conversions, no exposed history. Early users get priority setup.",
  web3_project_pitch:
    "Hey, Lisa here from Loofta Pay. I'm reaching out to a few projects that pay their team in crypto - is that your case? We're offering free access to our platform to pay your teammates privately, just using their email address. They claim it however they want. Would love to have you in.",
};

// ─── Type metadata ────────────────────────────────────────────────────────────

const TYPE_META: Record<ProspectType, { label: string; icon: React.ReactNode; badge: string }> = {
  creator:      { label: "Creator",      icon: <Mic2      className="h-3 w-3" />, badge: "border-orange-500/30 text-orange-300 bg-orange-500/10" },
  freelancer:   { label: "Freelancer",   icon: <Briefcase className="h-3 w-3" />, badge: "border-sky-500/30    text-sky-300    bg-sky-500/10"    },
  web3_project: { label: "Web3 Project", icon: <Building2 className="h-3 w-3" />, badge: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtFollowers(n: number | null): string {
  if (n === null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block mb-1.5 text-xs font-mono font-medium uppercase tracking-widest text-gray-400">{children}</span>;
}

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-orange-400">{icon}</span>
      <span className="text-sm font-mono font-medium uppercase tracking-widest text-gray-300">{children}</span>
    </div>
  );
}

function StatBox({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center w-20 h-16 rounded-lg bg-white/[0.04] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <span className={cn("text-2xl font-medium leading-none tabular-nums", highlight && value > 0 ? "text-orange-400" : "text-gray-100")}>{value}</span>
      <span className="mt-1 text-xs font-mono uppercase tracking-wider text-gray-500">{label}</span>
    </div>
  );
}

function TypeBadge({ type }: { type: ProspectType }) {
  const meta = TYPE_META[type] ?? TYPE_META.freelancer;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-mono font-medium uppercase tracking-wide px-2 py-0.5 rounded border", meta.badge)}>
      {meta.icon}{meta.label}
    </span>
  );
}

const STATUS_PILL: Record<string, string> = {
  drafted:        "bg-sky-500/20     text-sky-200     border-sky-400/40",
  approved:       "bg-emerald-500/20 text-emerald-200 border-emerald-400/40",
  rejected:       "bg-white/[0.06]   text-gray-400    border-white/[0.10]",
  sent:           "bg-violet-500/20  text-violet-200  border-violet-400/40",
  follow_pending: "bg-amber-500/20   text-amber-200   border-amber-400/40",
  "not a fit":    "bg-red-500/15     text-red-300     border-red-500/30",
  replied:        "bg-orange-500/20  text-orange-200  border-orange-400/40",
  followed:       "bg-teal-500/20    text-teal-200    border-teal-400/40",
};

function StatusPill({ label }: { label: string }) {
  return (
    <span className={cn("text-xs font-mono font-medium uppercase tracking-wide px-2 py-0.5 rounded border", STATUS_PILL[label] ?? "bg-white/[0.04] text-gray-400 border-white/[0.08]")}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

// ─── Glass button helpers ─────────────────────────────────────────────────────

const glassBtn = "bg-white/[0.05] border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] text-gray-300 hover:bg-white/[0.09] hover:text-white transition-colors";
const glassBtnActive = "bg-white/[0.10] border border-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] text-white";

// ─── Prospect Card ────────────────────────────────────────────────────────────

function ProspectCard({
  prospect, config, adminHash, onUpdate, onDelete, selected, onToggleSelect,
}: {
  prospect: Prospect;
  config: OutreachConfig;
  adminHash: string;
  onUpdate: (p: Prospect) => void;
  onDelete: (id: string) => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const { toast } = useToast();
  const [editedMessage, setEditedMessage] = useState(prospect.draft_message ?? "");
  const [isEditing, setIsEditing]         = useState(false);
  const [imgError, setImgError]           = useState(false);
  const [sending, setSending]             = useState(false);
  const [drafting, setDrafting]           = useState(false);

  useEffect(() => { setEditedMessage(prospect.draft_message ?? ""); }, [prospect.draft_message]);

  const h = useCallback(() => ({
    "x-admin-secret": adminHash,
    "Content-Type": "application/json",
  }), [adminHash]);

  async function draft() {
    setDrafting(true);
    const res = await fetch("/api/outreach/draft", {
      method: "POST", headers: h(),
      body: JSON.stringify({ prospectId: prospect.id, config }),
    });
    setDrafting(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast({ title: "Draft failed", description: b.error ?? "unknown", variant: "destructive" });
      return;
    }
    onUpdate(await res.json());
  }

  async function patch(update: Record<string, unknown>) {
    const res = await fetch(`/api/outreach/prospects/${prospect.id}`, {
      method: "PATCH", headers: h(), body: JSON.stringify(update),
    });
    if (res.ok) onUpdate(await res.json());
  }

  async function approve() {
    await patch({ status: "approved", final_message: isEditing ? editedMessage : (prospect.draft_message ?? "") });
    setIsEditing(false);
  }

  async function remove() {
    const res = await fetch(`/api/outreach/prospects/${prospect.id}`, {
      method: "DELETE", headers: { "x-admin-secret": adminHash },
    });
    if (res.ok) onDelete(prospect.id);
  }

  const isNew           = prospect.status === "new";
  const isDrafting      = prospect.status === "drafting";
  const isDrafted       = prospect.status === "drafted";
  const isApproved      = prospect.status === "approved";
  const isRejected      = prospect.status === "rejected";
  const isSent          = prospect.status === "sent";
  const isFollowPending = prospect.status === "follow_pending";
  const notFit          = isDrafted && prospect.qualified === false;
  const qualified       = isDrafted && prospect.qualified === true;

  async function sendDm() {
    setSending(true);
    const res = await fetch("/api/outreach/send-dm", {
      method: "POST", headers: h(),
      body: JSON.stringify({ prospectId: prospect.id }),
    });
    setSending(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast({ title: "DM failed", description: b.error ?? "unknown", variant: "destructive" });
      return;
    }
    onUpdate(await res.json());
    toast({ title: `DM sent to @${prospect.handle}` });
  }

  async function copyMessage() {
    const msg = prospect.final_message ?? prospect.draft_message ?? "";
    await navigator.clipboard.writeText(msg);
    toast({ title: "Message copied" });
  }

  const showAvatar = prospect.profile_image_url && !imgError;

  return (
    <div className={cn(
      "rounded-xl border p-4 transition-colors",
      selected         ? "ring-1 ring-white/25"  : "",
      isRejected      ? "border-white/10         bg-white/5               opacity-40"
      : isApproved    ? "border-emerald-500/30   bg-emerald-500/[0.06]"
      : isSent        ? "border-violet-500/30    bg-violet-500/[0.06]"
      : isFollowPending ? "border-amber-500/30   bg-amber-500/[0.06]"
      : "border-white/10 bg-white/5 hover:bg-white/[0.08]",
    )}>

      {/* Header row */}
      <div className="flex items-start gap-3">

        {/* Checkbox */}
        <button
          onClick={onToggleSelect}
          className={cn(
            "shrink-0 mt-1 h-5 w-5 rounded border transition-colors flex items-center justify-center",
            selected
              ? "bg-white/20 border-white/40 text-white"
              : "border-white/20 text-transparent hover:border-white/40",
          )}
        >
          {selected ? <CheckSquare2 className="h-4 w-4" /> : <Square className="h-4 w-4 opacity-0 group-hover:opacity-100" />}
        </button>

        {/* Avatar */}
        <a href={`https://x.com/${prospect.handle}`} target="_blank" rel="noopener noreferrer" className="shrink-0 mt-0.5">
          {showAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={prospect.profile_image_url!}
              alt={prospect.handle}
              onError={() => setImgError(true)}
              className="w-12 h-12 rounded-full object-cover ring-1 ring-white/10"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-white/10 ring-1 ring-white/10 flex items-center justify-center text-slate-300 font-mono font-medium text-base">
              {prospect.handle[0].toUpperCase()}
            </div>
          )}
        </a>

        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`https://x.com/${prospect.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono font-semibold text-white text-base hover:text-orange-400 transition-colors"
              >
                @{prospect.handle}
              </a>
              <TypeBadge type={prospect.type} />
              {notFit          && <StatusPill label="not a fit" />}
              {qualified       && <StatusPill label="drafted" />}
              {isApproved      && <StatusPill label="approved" />}
              {isRejected      && <StatusPill label="rejected" />}
              {isSent          && <StatusPill label="sent" />}
              {isFollowPending && <StatusPill label="follow_pending" />}
              {prospect.replied  && <StatusPill label="replied" />}
              {prospect.followed && <StatusPill label="followed" />}
            </div>
            <button onClick={remove} className="text-slate-600 hover:text-slate-300 transition-colors shrink-0">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {/* Followers + location */}
          <div className="flex items-center gap-3 mt-1.5">
            {prospect.followers_count !== null && (
              <span className="inline-flex items-center gap-1 text-base font-medium text-slate-300">
                <Users className="h-4 w-4 text-slate-400" />{fmtFollowers(prospect.followers_count)} followers
              </span>
            )}
            {prospect.location && (
              <span className="inline-flex items-center gap-1 text-base text-slate-400">
                <MapPin className="h-4 w-4" />{prospect.location}
              </span>
            )}
          </div>

          {/* Bio */}
          {prospect.bio && (
            <p className="mt-2 text-base text-slate-300 leading-relaxed">{prospect.bio}</p>
          )}
        </div>
      </div>

      {/* Not-a-fit reason */}
      {notFit && prospect.qualification_reason && (
        <p className="mt-2 text-base text-slate-400 italic pl-[60px]">{prospect.qualification_reason}</p>
      )}

      {/* Draft / approved / sent message */}
      {(qualified || isApproved || isSent) && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between mb-2">
            <FieldLabel>{isSent ? "sent message" : isApproved ? "approved message" : "draft message"}</FieldLabel>
            {qualified && !isEditing && (
              <button onClick={() => setIsEditing(true)} className="text-xs font-mono font-medium uppercase tracking-wide text-slate-500 hover:text-white transition-colors">
                edit
              </button>
            )}
          </div>

          {isEditing && qualified ? (
            <Textarea
              value={editedMessage}
              onChange={(e) => setEditedMessage(e.target.value)}
              className="text-base bg-white/5 border-white/10 min-h-[90px] resize-none text-white focus:border-orange-500/40"
              autoFocus
            />
          ) : (
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
              <p className="text-base text-white leading-relaxed whitespace-pre-wrap">
                {isSent
                  ? (prospect.final_message ?? prospect.draft_message)
                  : isApproved
                    ? (prospect.final_message ?? prospect.draft_message)
                    : prospect.draft_message}
              </p>
            </div>
          )}

          {qualified && (
            <div className="flex gap-2 mt-4">
              <button onClick={approve}
                className="inline-flex items-center gap-2 h-9 px-4 text-base rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 transition-colors font-medium">
                <Check className="h-4 w-4" /> Approve
              </button>
              <button onClick={() => patch({ status: "rejected" })}
                className={cn("inline-flex items-center gap-2 h-9 px-4 text-base rounded-lg font-medium transition-colors", glassBtn)}>
                <X className="h-4 w-4" /> Reject
              </button>
              <button onClick={draft} disabled={drafting}
                className={cn("inline-flex items-center gap-2 h-9 px-4 text-base rounded-lg font-medium transition-colors ml-auto disabled:opacity-50", glassBtn)}>
                {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {drafting ? "regenerating…" : "Regenerate"}
              </button>
            </div>
          )}

          {isApproved && (
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <button onClick={sendDm} disabled={sending}
                className="inline-flex items-center gap-2 h-9 px-4 text-base rounded-lg font-medium bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-50">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
                {sending ? "sending…" : "send DM"}
              </button>
              <button onClick={copyMessage}
                className={cn("inline-flex items-center gap-2 h-9 px-3 text-base rounded-lg font-medium transition-colors", glassBtn)}>
                <Copy className="h-4 w-4" /> copy
              </button>
              <a href={`https://x.com/${prospect.handle}`} target="_blank" rel="noopener noreferrer"
                className={cn("inline-flex items-center gap-2 h-9 px-3 text-base rounded-lg font-medium transition-colors", glassBtn)}>
                open X
              </a>
              <button onClick={() => patch({ status: "sent", sent_at: new Date().toISOString(), sent_via: "dm" })}
                className={cn("inline-flex items-center gap-2 h-9 px-3 text-base rounded-lg font-medium transition-colors ml-auto", glassBtn, "text-slate-500 hover:text-slate-300")}>
                <Check className="h-4 w-4" /> already sent
              </button>
            </div>
          )}
          {isSent && (
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/10">
              <span className="inline-flex items-center gap-1.5 text-base text-slate-500 font-medium">
                <SendHorizonal className="h-4 w-4" /> sent
              </span>
              {prospect.replied  && <span className="inline-flex items-center gap-1.5 text-base text-orange-400 font-medium"><MessageCircle className="h-4 w-4" /> replied</span>}
              {prospect.followed && <span className="inline-flex items-center gap-1.5 text-base text-teal-400 font-medium"><UserCheck className="h-4 w-4" /> follows you</span>}
            </div>
          )}
        </div>
      )}

      {/* CTA */}
      {(isNew || notFit) && (
        <div className="mt-4">
          <button onClick={draft}
            className={cn("inline-flex items-center gap-2 h-9 px-4 text-base rounded-lg font-medium transition-colors", glassBtn)}>
            <Play className="h-4 w-4" />{notFit ? "try again" : "qualify + draft"}
          </button>
        </div>
      )}

      {isDrafting && (
        <div className="mt-4 flex items-center gap-2 text-amber-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-base font-medium">qualifying + drafting…</span>
        </div>
      )}

      {isFollowPending && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-base text-amber-300/80 mb-3">
            DMs are restricted — we followed them. Once they follow back, hit <span className="font-medium text-amber-200">check engagement</span> and the DM button will reappear.
          </p>
          {(prospect.final_message ?? prospect.draft_message) && (
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 mb-3">
              <p className="text-base text-white leading-relaxed whitespace-pre-wrap">
                {prospect.final_message ?? prospect.draft_message}
              </p>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={sendDm} disabled={sending}
              className="inline-flex items-center gap-2 h-9 px-4 text-base rounded-lg font-medium bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition-colors disabled:opacity-50">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
              {sending ? "trying…" : "retry DM"}
            </button>
            <button onClick={() => patch({ status: "sent", sent_at: new Date().toISOString(), sent_via: "dm" })}
              className={cn("inline-flex items-center gap-2 h-9 px-3 text-base rounded-lg font-medium transition-colors ml-auto", glassBtn, "text-slate-500 hover:text-slate-300")}>
              <Check className="h-4 w-4" /> already sent
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Per-type pitch editor ────────────────────────────────────────────────────

function TypePitchConfig({
  config, onChange,
}: { config: OutreachConfig; onChange: (patch: Partial<OutreachConfig>) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-orange-400"><SlidersHorizontal className="h-4 w-4" /></span>
          <span className="text-sm font-mono font-medium uppercase tracking-widest text-gray-300">per-type pitches</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.06]">
          {([
            { key: "creator_pitch",      label: "Creator / KOL angle", color: "text-orange-400" },
            { key: "freelancer_pitch",   label: "Freelancer angle",    color: "text-sky-400"    },
            { key: "web3_project_pitch", label: "Web3 Project angle",  color: "text-emerald-400"},
          ] as const).map(({ key, label, color }) => (
            <div key={key} className="pt-3">
              <span className={cn("block mb-1.5 text-xs font-mono font-medium uppercase tracking-wider", color)}>{label}</span>
              <Textarea
                value={config[key] ?? ""}
                onChange={(e) => onChange({ [key]: e.target.value })}
                className="text-sm bg-white/[0.04] border-white/[0.08] min-h-[56px] resize-none text-gray-200 placeholder:text-gray-600 focus:border-orange-500/40"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OutreachDashboard({ adminHash }: { adminHash: string }) {
  const { toast }  = useToast();
  const pathname   = usePathname();
  const adminUrl   = pathname.replace(/\/outreach$/, "");

  const [config, setConfig]             = useState<OutreachConfig>(DEFAULT_CONFIG);
  const [configDirty, setConfigDirty]   = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const [prospects, setProspects]               = useState<Prospect[]>([]);
  const [loadingProspects, setLoadingProspects] = useState(true);

  const [newHandle, setNewHandle] = useState("");
  const [newBio, setNewBio]       = useState("");
  const [newType, setNewType]     = useState<ProspectType>("freelancer");
  const [adding, setAdding]       = useState(false);

  const [runningBatch, setRunningBatch]     = useState(false);
  const [discovering, setDiscovering]       = useState(false);
  const [discoveringDefi, setDiscoveringDefi] = useState(false);
  const [filter, setFilter]             = useState<Filter>("all");
  const [typeFilter, setTypeFilter]     = useState<Set<ProspectType>>(new Set());

  const authH = useCallback(() => ({ "x-admin-secret": adminHash }), [adminHash]);

  useEffect(() => {
    const h = authH();
    Promise.all([
      fetch("/api/outreach/config",    { headers: h }).then((r) => r.json()),
      fetch("/api/outreach/prospects", { headers: h }).then((r) => r.json()),
      fetch("/api/outreach/bulk-send", { headers: h }).then((r) => r.ok ? r.json() : null),
    ]).then(([cfg, { prospects: list }, job]) => {
      if (cfg && !cfg.error) setConfig((c) => ({ ...c, ...cfg }));
      setProspects(list ?? []);
      setLoadingProspects(false);
      if (job?.status === "running") setBulkJob(job);
    });
  }, [authH]);

  async function saveConfig() {
    setSavingConfig(true);
    const res = await fetch("/api/outreach/config", {
      method: "POST",
      headers: { ...authH(), "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setSavingConfig(false);
    if (res.ok) { setConfigDirty(false); toast({ title: "Config saved" }); }
  }

  async function addProspect() {
    if (!newHandle.trim()) return;
    setAdding(true);
    const res = await fetch("/api/outreach/prospects", {
      method: "POST",
      headers: { ...authH(), "Content-Type": "application/json" },
      body: JSON.stringify({ handle: newHandle, bio: newBio, type: newType }),
    });
    setAdding(false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "unknown" }));
      toast({ title: "Could not add", description: error, variant: "destructive" });
      return;
    }
    const added: Prospect = await res.json();
    setProspects((prev) => [added, ...prev]);
    setNewHandle(""); setNewBio("");
  }

  function handleUpdate(updated: Prospect) {
    setProspects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }
  function handleDelete(id: string) {
    setProspects((prev) => prev.filter((p) => p.id !== id));
  }

  async function runBatch() {
    const pending = prospects.filter((p) => p.status === "new");
    if (!pending.length) { toast({ title: "No new prospects to draft" }); return; }
    setRunningBatch(true);
    setProspects((prev) => prev.map((p) => p.status === "new" ? { ...p, status: "drafting" as const } : p));
    for (const p of pending) {
      const res = await fetch("/api/outreach/draft", {
        method: "POST",
        headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify({ prospectId: p.id, config }),
      });
      if (res.ok) {
        const u: Prospect = await res.json();
        setProspects((prev) => prev.map((x) => x.id === u.id ? u : x));
      } else {
        setProspects((prev) => prev.map((x) => x.id === p.id ? { ...x, status: "new" as const } : x));
      }
    }
    setRunningBatch(false);
    toast({ title: `Drafted ${pending.length} prospect${pending.length > 1 ? "s" : ""}` });
  }

  async function discover() {
    setDiscovering(true);
    const res = await fetch("/api/outreach/discover", {
      method: "POST",
      headers: { ...authH(), "Content-Type": "application/json" },
    });
    setDiscovering(false);
    const body = await res.json().catch(() => ({}));
    console.log("[discover] debug:", body.debug);
    if (!res.ok) {
      toast({ title: "Discovery failed", description: body.error ?? "unknown", variant: "destructive" });
      return;
    }
    const { added, prospects: newOnes, debug } = body;
    if (added > 0) {
      setProspects((prev) => [...(newOnes ?? []), ...prev]);
      toast({ title: `Found ${added} new prospect${added > 1 ? "s" : ""} on X` });
    } else {
      const lastLine = Array.isArray(debug) ? debug[debug.length - 1] : undefined;
      toast({ title: "No new prospects found", description: lastLine ?? "Check console for debug log." });
    }
  }

  async function discoverDefi() {
    setDiscoveringDefi(true);
    const res = await fetch("/api/outreach/discover-defi", {
      method: "POST",
      headers: { ...authH(), "Content-Type": "application/json" },
    });
    setDiscoveringDefi(false);
    const body = await res.json().catch(() => ({}));
    console.log("[discover-defi] debug:", body.debug);
    if (!res.ok) {
      toast({ title: "DeFi discovery failed", description: body.error ?? "unknown", variant: "destructive" });
      return;
    }
    const { added, prospects: newOnes } = body;
    if (added > 0) {
      setProspects((prev) => [...(newOnes ?? []), ...prev]);
      toast({ title: `Found ${added} DeFi project${added > 1 ? "s" : ""} on DefiLlama` });
    } else {
      toast({ title: "No new DeFi projects found" });
    }
  }

  const stats = {
    queue:    prospects.filter((p) => ["new","drafting","drafted"].includes(p.status)).length,
    approved: prospects.filter((p) => p.status === "approved").length,
    rejected: prospects.filter((p) => p.status === "rejected").length,
    sent:     prospects.filter((p) => p.status === "sent").length,
  };

  const filtered = prospects.filter((p) => {
    if      (filter === "all")      { if (!["new","drafting","drafted"].includes(p.status)) return false; }
    else if (filter === "approved") { if (!["approved","follow_pending"].includes(p.status)) return false; }
    else if (filter === "sent")     { if (p.status !== "sent") return false; }
    else if (filter === "rejected") { if (p.status !== "rejected") return false; }
    if (typeFilter.size > 0 && !typeFilter.has(p.type)) return false;
    return true;
  });

  const newCount     = prospects.filter((p) => p.status === "new").length;
  const draftedCount = prospects.filter((p) => p.status === "drafted" && p.qualified === true).length;

  const [checkingEngagement, setCheckingEngagement]   = useState(false);
  const [selected, setSelected]                       = useState<Set<string>>(new Set());
  const [bulkDraftingSelected, setBulkDraftingSelected] = useState(false);

  // Clear selection when tab changes
  useEffect(() => { setSelected(new Set()); }, [filter]);

  type BulkJob = {
    id: string;
    status: "running" | "done" | "stopped";
    total: number;
    sent: number;
    current_handle: string | null;
    error: string | null;
    finished_at: string | null;
  };
  const [bulkJob, setBulkJob] = useState<BulkJob | null>(null);

  async function bulkClean() {
    const toDelete = prospects.filter((p) =>
      p.status === "rejected" || (p.status === "drafted" && p.qualified === false),
    );
    if (!toDelete.length) { toast({ title: "Nothing to clean" }); return; }
    const h = { "x-admin-secret": adminHash };
    await Promise.all(toDelete.map((p) =>
      fetch(`/api/outreach/prospects/${p.id}`, { method: "DELETE", headers: h }),
    ));
    setProspects((prev) => prev.filter((p) => !toDelete.find((d) => d.id === p.id)));
    toast({ title: `Removed ${toDelete.length} rejected / not-a-fit prospect${toDelete.length > 1 ? "s" : ""}` });
  }

  async function checkEngagement() {
    setCheckingEngagement(true);
    const res = await fetch("/api/outreach/check-engagement", {
      method: "POST",
      headers: { "x-admin-secret": adminHash, "Content-Type": "application/json" },
    });
    setCheckingEngagement(false);
    const body = await res.json().catch(() => ({}));
    console.log("[check-engagement] debug:", body.debug);
    if (!res.ok) { toast({ title: "Check failed", description: body.error, variant: "destructive" }); return; }
    if (body.replied > 0 || body.followed > 0 || body.readyToDm > 0) {
      const fresh = await fetch("/api/outreach/prospects", { headers: { "x-admin-secret": adminHash } }).then((r) => r.json());
      setProspects(fresh.prospects ?? []);
      const parts = [];
      if (body.replied   > 0) parts.push(`${body.replied} replied`);
      if (body.followed  > 0) parts.push(`${body.followed} now following`);
      if (body.readyToDm > 0) parts.push(`${body.readyToDm} ready to DM`);
      toast({ title: parts.join(" · ") });
    } else {
      toast({ title: "No new replies or follows yet" });
    }
  }

  async function approveAll() {
    const toApprove = prospects.filter((p) => p.status === "drafted" && p.qualified === true);
    if (!toApprove.length) return;
    const h = { "x-admin-secret": adminHash, "Content-Type": "application/json" };
    const final_messages = Object.fromEntries(toApprove.map((p) => [p.id, p.draft_message ?? ""]));
    const res = await fetch("/api/outreach/prospects", {
      method: "PATCH", headers: h,
      body: JSON.stringify({ ids: toApprove.map((p) => p.id), final_messages }),
    });
    if (res.ok) {
      const { prospects: updated } = await res.json();
      updated.forEach((u: Prospect) => handleUpdate(u));
    }
    toast({ title: `Approved ${toApprove.length} message${toApprove.length > 1 ? "s" : ""}` });
  }

  async function bulkDraftSelected() {
    const toRun = prospects.filter((p) =>
      selected.has(p.id) && (p.status === "new" || (p.status === "drafted" && p.qualified === false)),
    );
    if (!toRun.length) return;
    setBulkDraftingSelected(true);
    setProspects((prev) => prev.map((p) => toRun.find((r) => r.id === p.id) ? { ...p, status: "drafting" as const } : p));
    for (const p of toRun) {
      const res = await fetch("/api/outreach/draft", {
        method: "POST",
        headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify({ prospectId: p.id, config }),
      });
      if (res.ok) {
        const u: Prospect = await res.json();
        setProspects((prev) => prev.map((x) => x.id === u.id ? u : x));
      } else {
        setProspects((prev) => prev.map((x) => x.id === p.id ? { ...x, status: "new" as const } : x));
      }
    }
    setBulkDraftingSelected(false);
    setSelected(new Set());
    toast({ title: `Drafted ${toRun.length} prospect${toRun.length > 1 ? "s" : ""}` });
  }

  async function bulkApproveSelected() {
    const toApprove = prospects.filter((p) =>
      selected.has(p.id) && p.status === "drafted" && p.qualified === true,
    );
    if (!toApprove.length) return;
    const h = { "x-admin-secret": adminHash, "Content-Type": "application/json" };
    const final_messages = Object.fromEntries(toApprove.map((p) => [p.id, p.draft_message ?? ""]));
    const res = await fetch("/api/outreach/prospects", {
      method: "PATCH", headers: h,
      body: JSON.stringify({ ids: toApprove.map((p) => p.id), final_messages }),
    });
    if (res.ok) {
      const { prospects: updated } = await res.json();
      updated.forEach((u: Prospect) => handleUpdate(u));
    }
    setSelected(new Set());
    toast({ title: `Approved ${toApprove.length} message${toApprove.length > 1 ? "s" : ""}` });
  }

  async function bulkRejectSelected() {
    const toReject = prospects.filter((p) => selected.has(p.id));
    if (!toReject.length) return;
    const h = { "x-admin-secret": adminHash, "Content-Type": "application/json" };
    await Promise.all(toReject.map((p) =>
      fetch(`/api/outreach/prospects/${p.id}`, {
        method: "PATCH", headers: h,
        body: JSON.stringify({ status: "rejected" }),
      }).then((r) => r.ok ? r.json() : null).then((u) => u && handleUpdate(u)),
    ));
    setSelected(new Set());
    toast({ title: `Rejected ${toReject.length} prospect${toReject.length > 1 ? "s" : ""}` });
  }

  async function bulkSendDMs() {
    const res = await fetch("/api/outreach/bulk-send", { method: "POST", headers: authH() });
    const body = await res.json();
    if (!res.ok) {
      toast({ title: body.error ?? "Failed to start bulk send", variant: "destructive" });
      return;
    }
    setBulkJob({ id: body.jobId, status: "running", total: body.total, sent: 0, current_handle: null, error: null, finished_at: null });
  }

  // Poll for job status every 5s while a job is running
  useEffect(() => {
    if (bulkJob?.status !== "running") return;
    const timer = setInterval(async () => {
      const res = await fetch("/api/outreach/bulk-send", { headers: authH() });
      if (!res.ok) return;
      const job: BulkJob = await res.json();
      setBulkJob(job);
      if (job.status !== "running") {
        const { prospects: list } = await fetch("/api/outreach/prospects", { headers: authH() }).then((r) => r.json());
        setProspects(list ?? []);
        if (job.status === "done")    toast({ title: `Sent ${job.sent} DM${job.sent !== 1 ? "s" : ""}` });
        if (job.status === "stopped") toast({ title: job.error ?? "Bulk send stopped", variant: "destructive" });
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [bulkJob?.status, authH]);

  return (
    <div className="min-h-screen bg-[#0f0f12] text-white font-sans">

      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 bg-[#0d0d10]">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href={adminUrl} className="text-gray-600 hover:text-gray-300 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-medium text-gray-100">Outbound Agent</h1>
          </div>
          <div className="flex items-center gap-2">
            <StatBox value={stats.queue}    label="queue"    highlight />
            <StatBox value={stats.approved} label="approved" />
            <StatBox value={stats.rejected} label="rejected" />
            <StatBox value={stats.sent}     label="sent"     />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto flex gap-6 p-6">

        {/* Left panel */}
        <div className="w-80 shrink-0 flex flex-col gap-4">

          {/* Shape the agent */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <SectionHeading icon={<SlidersHorizontal className="h-4 w-4" />}>
              Shape the agent
            </SectionHeading>
            <div className="space-y-4">
              <div>
                <FieldLabel>product pitch</FieldLabel>
                <Textarea value={config.product_pitch}
                  onChange={(e) => { setConfig((c) => ({ ...c, product_pitch: e.target.value })); setConfigDirty(true); }}
                  className="text-sm bg-white/[0.04] border-white/[0.08] min-h-[72px] resize-none text-gray-200 focus:border-orange-500/40" />
              </div>
              <div>
                <FieldLabel>tone</FieldLabel>
                <Textarea value={config.message_tone}
                  onChange={(e) => { setConfig((c) => ({ ...c, message_tone: e.target.value })); setConfigDirty(true); }}
                  className="text-sm bg-white/[0.04] border-white/[0.08] min-h-[56px] resize-none text-gray-200 focus:border-orange-500/40" />
              </div>
              <div>
                <FieldLabel>call to action</FieldLabel>
                <Textarea value={config.call_to_action}
                  onChange={(e) => { setConfig((c) => ({ ...c, call_to_action: e.target.value })); setConfigDirty(true); }}
                  className="text-sm bg-white/[0.04] border-white/[0.08] min-h-[48px] resize-none text-gray-200 focus:border-orange-500/40" />
              </div>
            </div>
            {configDirty && (
              <button onClick={saveConfig} disabled={savingConfig}
                className={cn("mt-4 w-full h-9 text-sm rounded-lg font-medium transition-colors flex items-center justify-center gap-2", glassBtn, "border-orange-500/30 text-orange-300 hover:bg-orange-500/10")}>
                {savingConfig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}save config
              </button>
            )}
            <p className="mt-3 text-sm text-gray-500 leading-relaxed">changes apply to the next draft.</p>
          </div>

          {/* Per-type pitches (collapsible) */}
          <TypePitchConfig config={config} onChange={(patch) => { setConfig((c) => ({ ...c, ...patch })); setConfigDirty(true); }} />

          {/* Add a prospect manually */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <SectionHeading icon={<Target className="h-4 w-4" />}>Add manually</SectionHeading>
            <div className="space-y-2.5">
              <Input value={newHandle} onChange={(e) => setNewHandle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && addProspect()}
                placeholder="@handle"
                className="h-9 text-sm bg-white/[0.04] border-white/[0.08] text-gray-200 placeholder:text-gray-600 focus:border-orange-500/40" />
              <Textarea value={newBio} onChange={(e) => setNewBio(e.target.value)}
                placeholder="bio / signal…"
                className="text-sm bg-white/[0.04] border-white/[0.08] min-h-[64px] resize-none text-gray-200 placeholder:text-gray-600 focus:border-orange-500/40" />

              <div className="grid grid-cols-3 gap-1.5">
                {(["creator","freelancer","web3_project"] as ProspectType[]).map((t) => (
                  <button key={t} onClick={() => setNewType(t)}
                    className={cn(
                      "h-8 rounded-lg text-xs font-mono font-medium uppercase tracking-wide border transition-colors",
                      newType === t ? glassBtnActive : glassBtn,
                    )}>
                    {TYPE_META[t].label}
                  </button>
                ))}
              </div>

              <button onClick={addProspect} disabled={adding || !newHandle.trim()}
                className={cn("w-full h-9 text-sm rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40", glassBtn)}>
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="text-base leading-none">+</span>}
                add to queue
              </button>
            </div>
          </div>

          {/* Discover */}
          <button onClick={discover} disabled={discovering}
            className={cn("w-full h-11 text-sm rounded-xl font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50", glassBtn)}>
            {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {discovering ? "searching X…" : "discover on X"}
          </button>

          <button onClick={discoverDefi} disabled={discoveringDefi}
            className={cn("w-full h-11 text-sm rounded-xl font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50", glassBtn, "text-emerald-400/80 hover:text-emerald-300 hover:border-emerald-500/20")}>
            {discoveringDefi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
            {discoveringDefi ? "scanning DefiLlama…" : "discover DeFi projects"}
          </button>

          <GradientActionButton onClick={runBatch} loading={runningBatch} loadingText="running agent…"
            disabled={runningBatch || newCount === 0}>
            <Zap className="h-4 w-4" />
            run agent on queue
            {newCount > 0 && (
              <span className="ml-1.5 rounded bg-white/20 px-2 py-0.5 text-xs font-mono font-medium">{newCount}</span>
            )}
          </GradientActionButton>

          <button onClick={checkEngagement} disabled={checkingEngagement}
            className={cn("w-full h-11 text-sm rounded-xl font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50", glassBtn)}>
            {checkingEngagement ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            {checkingEngagement ? "checking…" : "check engagement"}
          </button>

          <button onClick={bulkClean}
            className={cn("w-full h-11 text-sm rounded-xl font-medium transition-colors flex items-center justify-center gap-2", glassBtn, "text-red-400/70 hover:text-red-300 hover:border-red-500/20")}>
            <Trash2 className="h-4 w-4" />
            bulk clean
          </button>
        </div>

        {/* Right panel */}
        <div className="flex-1 min-w-0">

          {/* Filter tabs + type legend */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {draftedCount > 0 && (
              <button onClick={approveAll}
                className="inline-flex items-center gap-2 h-9 px-4 text-sm rounded-xl font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition-colors">
                <Check className="h-3.5 w-3.5" />
                approve all ({draftedCount})
              </button>
            )}
            {filter === "approved" && (stats.approved > 0 || bulkJob?.status === "running") && (() => {
              const running = bulkJob?.status === "running";
              const label   = running
                ? (bulkJob!.current_handle
                    ? `sending ${bulkJob!.sent + 1} / ${bulkJob!.total} — @${bulkJob!.current_handle}`
                    : bulkJob!.sent === 0
                      ? `starting…`
                      : `pausing… ${bulkJob!.sent} / ${bulkJob!.total} sent`)
                : `send all DMs (${stats.approved})`;
              return (
                <div className="flex items-center gap-2">
                  <button
                    onClick={bulkSendDMs}
                    disabled={running}
                    className={cn(
                      "inline-flex items-center gap-2 h-9 px-4 text-sm rounded-xl font-medium transition-colors disabled:opacity-50",
                      glassBtn, "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10",
                    )}
                  >
                    {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizonal className="h-3.5 w-3.5" />}
                    {label}
                  </button>
                  {running && (
                    <button
                      onClick={async () => {
                        await fetch("/api/outreach/bulk-send", { method: "DELETE", headers: authH() });
                        setBulkJob((j) => j ? { ...j, status: "stopped" } : null);
                      }}
                      className={cn("inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-xl font-medium transition-colors", glassBtn, "border-red-500/30 text-red-400 hover:bg-red-500/10")}
                      title="Stop bulk send"
                    >
                      <Square className="h-3.5 w-3.5" /> stop
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="flex gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              {(["all","approved","sent","rejected"] as Filter[]).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={cn(
                    "px-4 h-8 rounded-lg text-sm font-mono font-medium uppercase tracking-wide transition-all",
                    filter === f ? glassBtnActive : "text-gray-500 hover:text-gray-300",
                  )}>
                  {f}
                </button>
              ))}
            </div>
            {filtered.length > 0 && (
              <button
                onClick={() => {
                  const allIds = new Set(filtered.map((p) => p.id));
                  const allSelected = filtered.every((p) => selected.has(p.id));
                  setSelected(allSelected ? new Set() : allIds);
                }}
                className={cn("inline-flex items-center gap-1.5 h-8 px-3 text-sm font-mono font-medium rounded-lg border transition-colors", glassBtn)}
              >
                {filtered.every((p) => selected.has(p.id)) && filtered.length > 0
                  ? <><CheckSquare2 className="h-3.5 w-3.5" /> deselect all</>
                  : <><Square className="h-3.5 w-3.5" /> select all</>}
              </button>
            )}
            <div className="flex gap-2 ml-auto flex-wrap">
              {(Object.entries(TYPE_META) as [ProspectType, typeof TYPE_META[ProspectType]][]).map(([t, m]) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter((prev) => {
                    const next = new Set(prev);
                    next.has(t) ? next.delete(t) : next.add(t);
                    return next;
                  })}
                  className={cn(
                    "inline-flex items-center gap-1 text-xs font-mono font-medium uppercase px-2.5 py-1 rounded-lg border transition-all",
                    m.badge,
                    typeFilter.has(t)
                      ? "opacity-100 ring-1 ring-white/20 scale-105"
                      : "opacity-50 hover:opacity-80",
                  )}
                >
                  {m.icon}{m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Bulk action toolbar */}
          {selected.size > 0 && (() => {
            const draftable  = prospects.filter((p) => selected.has(p.id) && (p.status === "new" || (p.status === "drafted" && p.qualified === false))).length;
            const approvable = prospects.filter((p) => selected.has(p.id) && p.status === "drafted" && p.qualified === true).length;
            return (
              <div className="flex flex-wrap items-center gap-2 mb-4 px-4 py-2.5 rounded-xl bg-white/[0.06] border border-white/10">
                <span className="text-sm font-mono font-medium text-gray-300">{selected.size} selected</span>
                <div className="h-4 w-px bg-white/15 mx-1" />
                {draftable > 0 && (
                  <button onClick={bulkDraftSelected} disabled={bulkDraftingSelected}
                    className={cn("inline-flex items-center gap-1.5 h-8 px-3 text-sm rounded-lg font-medium transition-colors disabled:opacity-50", glassBtn)}>
                    {bulkDraftingSelected ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    draft {draftable > 1 ? `(${draftable})` : ""}
                  </button>
                )}
                {approvable > 0 && (
                  <button onClick={bulkApproveSelected}
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-sm rounded-lg font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition-colors">
                    <Check className="h-3.5 w-3.5" /> approve {approvable > 1 ? `(${approvable})` : ""}
                  </button>
                )}
                <button onClick={bulkRejectSelected}
                  className={cn("inline-flex items-center gap-1.5 h-8 px-3 text-sm rounded-lg font-medium transition-colors", glassBtn, "text-red-400/70 hover:text-red-300 hover:border-red-500/20")}>
                  <X className="h-3.5 w-3.5" /> reject
                </button>
                <button onClick={() => setSelected(new Set())} className="ml-auto text-gray-500 hover:text-gray-300 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })()}

          {loadingProspects ? (
            <div className="flex items-center justify-center h-40 gap-2 text-gray-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-mono font-medium">loading queue…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-gray-600">
              <Target className="h-6 w-6" />
              <span className="text-sm font-mono font-medium">
                {filter === "all" ? "click 'discover on X' to find new leads" : `no ${filter} prospects`}
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((p) => (
                <ProspectCard key={p.id} prospect={p} config={config} adminHash={adminHash}
                  onUpdate={handleUpdate} onDelete={handleDelete}
                  selected={selected.has(p.id)}
                  onToggleSelect={() => setSelected((prev) => {
                    const next = new Set(prev);
                    next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                    return next;
                  })} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
