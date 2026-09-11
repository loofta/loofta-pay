"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Mail, Plus, X, Calendar as CalendarGlyph, Check, ImagePlus, Smile, ChevronDown } from "lucide-react";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy, useLinkAccount } from "@privy-io/react-auth";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/RichTextEditor";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { LogoCropModal } from "@/components/LogoCropModal";
import { GiveawayLivePreview, type PreviewTask } from "@/components/GiveawayLivePreview";
import { CONTINENTS, COUNTRIES, type Continent } from "@/lib/countries";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import posthog from "posthog-js";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const GRADIENT = "linear-gradient(to right, #EAB308, #FF0F00)";
const TOTAL_STEPS = 5;

// Total prize pool is the free/primary input; the winners slider only stops on values that
// divide it evenly, so prize-per-winner is always a whole dollar amount — no need to round or
// display cents. Changing the pool re-snaps the current winner count to the nearest still-valid
// divisor if it no longer divides evenly.
const MIN_TOTAL_POOL = 20;
// Lower floor for an admin testing the full mechanism end to end ("create as Loofta") — real
// creators still see the normal $20 floor above.
const ADMIN_MIN_TOTAL_POOL = 10;
const MAX_TOTAL_POOL = 10_000;
// Frontend-only UI ceiling for the winners slider/divisor search — the backend has no upper
// bound on winner_count (only winner_count > 0), so this is purely about keeping
// divisorsUpTo's search bounded and the "Winners" picker usable, not a real business limit.
const MAX_WINNERS = 1000;

/** Every whole-number winner count from 1..max that divides `total` evenly — the pool of
 *  selectable positions for the winners slider. Always non-empty (1 always divides everything). */
function divisorsUpTo(total: number, max: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= max; i++) {
    if (total % i === 0) out.push(i);
  }
  return out.length ? out : [1];
}

/** Nearest value in `options` to `target` — used to re-snap winnerCount when the pool changes
 *  and its old value no longer divides evenly. */
function nearest(options: number[], target: number): number {
  return options.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), options[0]);
}

// "Engage with a post" is one category covering several X actions on the same tweet (RT/like/
// comment/bookmark, independently toggled) rather than a single task_type — matches how a
// creator actually thinks about it ("do these things to this post"), and expands into one
// backend task row per checked action at submit time (see expandTaskRow).
type TaskCategory = "engage" | "x_follow" | "x_post" | "telegram_join" | "discord_join" | "custom";
type BackendTaskType = "x_follow" | "x_retweet" | "x_like" | "x_comment" | "x_bookmark" | "x_post" | "telegram_join" | "discord_join" | "custom";

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  engage: "Engage with a post",
  x_follow: "Follow on X",
  x_post: "Post on X",
  telegram_join: "Join Telegram",
  discord_join: "Join Discord",
  custom: "Custom task",
};

/** Icon shown per task category in the live preview panel only — purely decorative, no bearing
 *  on the backend task_type. */
const CATEGORY_ICONS: Record<TaskCategory, string> = {
  engage: "💬",
  x_follow: "𝕏",
  x_post: "✍️",
  telegram_join: "✈️",
  discord_join: "🎮",
  custom: "✨",
};

const CATEGORY_TARGET_LABELS: Record<TaskCategory, string> = {
  engage: "Tweet URL",
  x_follow: "X handle to follow (e.g. loofta)",
  x_post: "Exact text they must post",
  telegram_join: "Telegram channel/group link",
  discord_join: "Discord invite link",
  custom: "Link (optional) — e.g. https://twitch.tv/yourstream",
};

/** Categories nothing can auto-verify — completion is always self-reported and reviewed by the
 *  creator/admin. These are the only ones offered a "require proof" toggle: the auto_api
 *  categories (follow, x_post, and RT/like/comment under engage) are checked against the real X
 *  API, so asking for a screenshot on top of that would be redundant. "Visit a link" was folded
 *  into "custom" (2026-09-11) — the two were functionally identical (a link + free-text
 *  description, both self-reported), so custom's own title/link fields already cover it, with
 *  "Join waitlist" / "Create an account" now just examples in custom's placeholder instead of a
 *  separate category. Existing giveaways with an already-saved visit_link task keep rendering
 *  fine (backend/entity support wasn't removed) — collapseTasksToRows below folds one into a
 *  custom row if a creator ever reopens that giveaway to edit it. */
const SELF_REPORT_CATEGORIES = new Set<TaskCategory>(["telegram_join", "discord_join", "custom"]);

/** Bookmark has no real verification path — X has no public "who bookmarked this tweet"
 *  endpoint (bookmarks are private per-user data), unlike retweet/like which do. Always
 *  self-reported + reviewed, same as telegram/discord/custom. */
const ENGAGE_ACTIONS = [
  { key: "retweet" as const, label: "Retweet", auto: true },
  { key: "like" as const, label: "Like", auto: true },
  { key: "comment" as const, label: "Comment", auto: true },
  { key: "bookmark" as const, label: "Bookmark", auto: false },
];

interface TaskRow {
  id: string;
  category: TaskCategory;
  target: string;
  /** custom tasks only — the short title shown to the entrant (e.g. "Join the stream"); `target` is the accompanying link, optional. */
  title: string;
  instructions: string;
  /** x_post only — the exact text the entrant must post as a new tweet. */
  requiredText: string;
  requireProof: boolean;
  engage: { retweet: boolean; like: boolean; comment: boolean; bookmark: boolean };
}

function newRow(): TaskRow {
  return {
    id: crypto.randomUUID(),
    category: "engage",
    target: "",
    title: "",
    instructions: "",
    requiredText: "",
    requireProof: false,
    engage: { retweet: true, like: false, comment: false, bookmark: false },
  };
}

function rowIsValid(row: TaskRow): boolean {
  if (row.category === "custom") return row.title.trim().length > 0;
  // requiredText defaults to "" via newRow(), but a draft persisted to localStorage before this
  // field existed won't have it on older rows at all — guard against undefined rather than crash
  // the instant someone switches an old row to this category.
  if (row.category === "x_post") return (row.requiredText ?? "").trim().length > 0;
  if (!row.target.trim()) return false;
  if (row.category === "engage") return row.engage.retweet || row.engage.like || row.engage.comment || row.engage.bookmark;
  return true;
}

/** One TaskRow -> one or more backend {task_type, config} objects — an "engage" row with 3
 *  actions checked becomes 3 separate task rows server-side, each independently verifiable. */
function expandTaskRow(row: TaskRow): Array<{ task_type: BackendTaskType; config: Record<string, unknown> }> {
  if (row.category === "custom") {
    const config: Record<string, unknown> = { title: row.title.trim() };
    if (row.target.trim()) config.target = row.target.trim();
    config.require_proof = row.requireProof;
    return [{ task_type: "custom", config }];
  }
  if (row.category === "x_post") {
    return [{ task_type: "x_post", config: { required_text: (row.requiredText ?? "").trim() } }];
  }
  if (row.category !== "engage") {
    const config: Record<string, unknown> = { target: row.target.trim() };
    if (SELF_REPORT_CATEGORIES.has(row.category)) config.require_proof = row.requireProof;
    return [{ task_type: row.category, config }];
  }
  const out: Array<{ task_type: BackendTaskType; config: Record<string, unknown> }> = [];
  const instructions = row.instructions.trim() || undefined;
  if (row.engage.retweet) out.push({ task_type: "x_retweet", config: { target: row.target.trim(), instructions } });
  if (row.engage.like) out.push({ task_type: "x_like", config: { target: row.target.trim(), instructions } });
  if (row.engage.comment) out.push({ task_type: "x_comment", config: { target: row.target.trim(), comment_requirement: instructions } });
  if (row.engage.bookmark) {
    out.push({ task_type: "x_bookmark", config: { target: row.target.trim(), comment_requirement: instructions, require_proof: row.requireProof } });
  }
  return out;
}

/** Reverse of expandTaskRow — used only in edit mode, to turn the backend's already-exploded
 *  task rows back into the wizard's TaskRow shape. x_retweet/x_like/x_comment/x_bookmark rows
 *  that share the same target collapse back into one "engage" row; everything else maps 1:1. */
function collapseTasksToRows(tasks: Array<{ task_type: string; config: Record<string, any> }>): TaskRow[] {
  const ENGAGE_TYPES = new Set(["x_retweet", "x_like", "x_comment", "x_bookmark"]);
  const rows: TaskRow[] = [];
  const engageByTarget = new Map<string, TaskRow>();
  for (const t of tasks) {
    const target = String(t.config?.target ?? "");
    if (ENGAGE_TYPES.has(t.task_type)) {
      let row = engageByTarget.get(target);
      if (!row) {
        row = { id: crypto.randomUUID(), category: "engage", target, title: "", instructions: "", requiredText: "", requireProof: false, engage: { retweet: false, like: false, comment: false, bookmark: false } };
        engageByTarget.set(target, row);
        rows.push(row);
      }
      if (t.task_type === "x_retweet") {
        row.engage.retweet = true;
        if (t.config?.instructions) row.instructions = t.config.instructions;
      }
      if (t.task_type === "x_like") {
        row.engage.like = true;
        if (t.config?.instructions) row.instructions = t.config.instructions;
      }
      if (t.task_type === "x_comment") {
        row.engage.comment = true;
        if (t.config?.comment_requirement) row.instructions = t.config.comment_requirement;
      }
      if (t.task_type === "x_bookmark") {
        row.engage.bookmark = true;
        if (t.config?.comment_requirement) row.instructions = t.config.comment_requirement;
        if (t.config?.require_proof) row.requireProof = true;
      }
    } else if (t.task_type === "custom") {
      // Rows created before config.title existed only have the old free-text `target` as a
      // description — surface it as the title on edit rather than silently dropping it.
      const hasTitle = typeof t.config?.title === "string" && t.config.title.trim().length > 0;
      rows.push({
        id: crypto.randomUUID(),
        category: "custom",
        target: hasTitle ? target : "",
        title: hasTitle ? t.config.title : target,
        instructions: t.config?.instructions ?? "",
        requiredText: "",
        requireProof: !!t.config?.require_proof,
        engage: { retweet: false, like: false, comment: false, bookmark: false },
      });
    } else if (t.task_type === "visit_link") {
      // "Visit a link" was folded into "custom" (2026-09-11) — no longer a selectable category,
      // but an older giveaway can still have one saved. Editing it collapses it straight into a
      // custom row (its old `instructions` becomes the title, since custom has no separate
      // instructions field), so it saves back out as "custom" from then on.
      rows.push({
        id: crypto.randomUUID(),
        category: "custom",
        target,
        title: t.config?.instructions || "Visit a link",
        instructions: "",
        requiredText: "",
        requireProof: !!t.config?.require_proof,
        engage: { retweet: false, like: false, comment: false, bookmark: false },
      });
    } else if (t.task_type === "x_post") {
      rows.push({
        id: crypto.randomUUID(),
        category: "x_post",
        target: "",
        title: "",
        instructions: "",
        requiredText: t.config?.required_text ?? "",
        requireProof: false,
        engage: { retweet: false, like: false, comment: false, bookmark: false },
      });
    } else {
      rows.push({
        id: crypto.randomUUID(),
        category: t.task_type as TaskCategory,
        target,
        title: "",
        instructions: t.config?.instructions ?? "",
        requiredText: "",
        requireProof: !!t.config?.require_proof,
        engage: { retweet: false, like: false, comment: false, bookmark: false },
      });
    }
  }
  return rows.length ? rows : [newRow()];
}

const MAX_TASKS = 8;

// shadcn's Input/Label/Textarea default to "text-base md:text-sm" — silently dropping to 14px on
// any desktop-width screen no matter what size class we add, since a bare "text-xl" (no md:
// variant) loses to their "md:text-sm" at md+ widths. Must repeat the size at md: explicitly to
// actually override it.
// [appearance:textfield] + hiding the webkit spin button removes the native up/down stepper —
// it renders inconsistently across inputs (only shows once a value is typed) and looks out of
// place against the rest of the styled form.
const inputClass =
  "bg-white/[0.06] border-white/15 text-white placeholder:text-slate-500 text-base md:text-base h-11 " +
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0";
const labelClass = "text-slate-200 text-base md:text-base font-medium mb-1.5 block";
const helperClass = "text-base md:text-base text-slate-400";

/** Custom-styled range slider — a native <input type="range"> alone looks like bare browser
 *  chrome even with `accent-color`, so the visible track/fill is a separate absolutely
 *  positioned bar underneath a transparent-track native input (thumb still native, but
 *  restyled via ::-webkit-slider-thumb / ::-moz-range-thumb). */
function RangeSlider({
  min,
  max,
  step,
  value,
  onChange,
  onCommit,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  /** Fires once the drag/keypress that changed the value has actually ended (mouseup/touchend/
   *  keyup) — for side effects that shouldn't re-run on every intermediate tick while dragging
   *  (e.g. re-snapping a derived value), pass a handler here instead of doing it in onChange. */
  onCommit?: (v: number) => void;
}) {
  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const commit = (e: React.SyntheticEvent<HTMLInputElement>) => onCommit?.(Number(e.currentTarget.value));
  return (
    <div className="relative h-6 flex items-center">
      <div className="absolute inset-x-0 h-2 rounded-full bg-white/10" />
      <div className="absolute h-2 rounded-full pointer-events-none" style={{ width: `${pct}%`, background: GRADIENT }} />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        className={[
          "relative w-full h-6 appearance-none bg-transparent cursor-pointer m-0",
          "[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-runnable-track]:rounded-full",
          "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5",
          "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#FF7A2A]",
          "[&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(0,0,0,0.4)] [&::-webkit-slider-thumb]:cursor-pointer",
          "[&::-moz-range-track]:h-2 [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:rounded-full",
          "[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white",
          "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#FF7A2A] [&::-moz-range-thumb]:shadow-[0_2px_8px_rgba(0,0,0,0.4)]",
        ].join(" ")}
      />
    </div>
  );
}

const STEP_LABELS = ["Basics", "Prize", "Tasks", "Timing", "Launch"] as const;

/** Dot-per-step stepper with a filling connector between dots — replaces a bare linear progress
 *  bar so a creator can see exactly which stage they're on and how many are left at a glance.
 *  `justCompleted` briefly pops the dot that was just finished (set by goNext, cleared ~600ms
 *  later) as a lightweight "that landed" cue. */
function StepDots({ step, justCompleted }: { step: number; justCompleted: number }) {
  return (
    <div className="mb-9 flex items-center">
      {STEP_LABELS.map((label, i) => {
        const idx = i + 1;
        return (
          <div key={label} className="contents">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-[30px] w-[30px] items-center justify-center rounded-full font-display text-[13px] font-medium transition-all duration-500 ${
                  justCompleted === idx ? "animate-[g-pop_500ms_cubic-bezier(.16,1,.3,1)]" : ""
                }`}
                style={{
                  background: idx < step ? GRADIENT : idx === step ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.03)",
                  border: idx === step ? "1.5px solid #FF6A00" : "none",
                  boxShadow: idx === step ? "0 0 20px rgba(255,106,0,.3)" : "none",
                  color: idx <= step ? "#fff" : "#64748b",
                }}
              >
                {idx < step ? <Check className="h-3 w-3" strokeWidth={3} /> : idx}
              </div>
              <span className={`font-grotesk text-[10px] font-medium uppercase tracking-[0.06em] ${idx === step ? "text-white" : "text-slate-600"}`}>{label}</span>
            </div>
            {idx < STEP_LABELS.length && (
              <div className="mx-2 mb-[18px] h-0.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ background: GRADIENT, width: idx < step ? "100%" : "0%" }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Same "YYYY-MM-DDTHH:mm" shape a native datetime-local input produces, so the rest of the
 *  form (validation, ISO conversion on submit) doesn't need to know this isn't a native input. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function DateTimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const selectedDate = value ? new Date(value) : undefined;
  const timeValue = selectedDate
    ? `${String(selectedDate.getHours()).padStart(2, "0")}:${String(selectedDate.getMinutes()).padStart(2, "0")}`
    : "12:00";

  const setDatePart = (date: Date | undefined) => {
    if (!date) return;
    const next = new Date(date);
    if (selectedDate) next.setHours(selectedDate.getHours(), selectedDate.getMinutes());
    else next.setHours(12, 0);
    onChange(toLocalInputValue(next));
  };

  const setTimePart = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    const next = new Date(selectedDate ?? new Date());
    next.setHours(h, m, 0, 0);
    onChange(toLocalInputValue(next));
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={`${inputClass} w-full flex items-center justify-between px-3`}>
          <span className={selectedDate ? "" : "text-slate-500"}>
            {selectedDate ? selectedDate.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Pick a date and time"}
          </span>
          <CalendarGlyph className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto bg-[#17171b] border-white/15 text-white p-3">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={setDatePart}
          disabled={(date) => date < today}
        />
        <div className="flex items-center gap-2 mt-1 px-1 pb-1">
          <span className="text-sm text-slate-400">Time</span>
          <input
            type="time"
            value={timeValue}
            onChange={(e) => setTimePart(e.target.value)}
            className="flex-1 rounded-lg bg-white/[0.06] border border-white/15 text-white text-base px-2 py-1.5"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Label + "optional" tag on the same row (never wraps to 2 lines), so a longer label next to a
 *  shorter one in a 2-column grid doesn't push its input down relative to its neighbor. */
function FieldLabel({ children, optional }: { children: ReactNode; optional?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5 mb-1.5">
      <Label className="text-slate-200 text-base font-medium block">{children}</Label>
      {optional && <span className="text-slate-500 text-sm shrink-0">optional</span>}
    </div>
  );
}

/** Plain-text field (with an emoji picker) for x_post's required_text — deliberately not
 *  RichTextEditor: X posts have no markdown, so a bold/italic/link/preview toolbar would offer
 *  formatting controls that do nothing once actually posted. Emoji insertion is the same
 *  insert-at-cursor pattern RichTextEditor.tsx uses, just without the rest of its toolbar. */
function RequiredTextField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const insertAtCursor = useCallback((text: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange(value + text);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = value.slice(0, start) + text + value.slice(end);
    const cursor = start + text.length;
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(cursor, cursor); });
  }, [value, onChange]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10">
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
              aria-label="Add emoji"
            >
              <Smile className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border-white/10 overflow-hidden" align="start">
            <EmojiPicker
              theme={Theme.DARK}
              onEmojiClick={(emoji: EmojiClickData) => { insertAtCursor(emoji.emoji); setEmojiOpen(false); }}
            />
          </PopoverContent>
        </Popover>
        <span className="text-sm text-slate-500">{value.length}/280</span>
      </div>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={CATEGORY_TARGET_LABELS.x_post}
        maxLength={280}
        rows={3}
        className="border-0 rounded-none bg-transparent focus-visible:ring-0 resize-none text-base md:text-base"
      />
    </div>
  );
}

/** Searchable multi-select for eligibility's required_countries — same Command+Popover combobox
 *  building blocks as BankCombobox/TokenCombobox elsewhere in the app, except it stays open
 *  across picks (toggling a checkmark) instead of closing after one selection, and shows every
 *  picked country as a removable chip below the trigger. */
function CountryMultiSelect({
  selected,
  onAdd,
  onRemove,
}: {
  selected: string[];
  onAdd: (country: string) => void;
  onRemove: (country: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" role="combobox" aria-expanded={open} className={`${inputClass} w-full flex items-center justify-between px-3`}>
            <span className={selected.length ? "" : "text-slate-500"}>
              {selected.length ? `${selected.length} countr${selected.length === 1 ? "y" : "ies"} selected` : "Add specific countries…"}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0 bg-[#17171b] border-white/15">
          <Command className="bg-transparent text-white">
            <CommandInput placeholder="Search countries…" className="text-white placeholder:text-slate-500" />
            <CommandList className="max-h-64">
              <CommandEmpty className="py-6 text-center text-base text-slate-400">No country found.</CommandEmpty>
              <CommandGroup>
                {COUNTRIES.map((country) => (
                  <CommandItem
                    key={country}
                    value={country}
                    onSelect={() => (selected.includes(country) ? onRemove(country) : onAdd(country))}
                    className="text-white data-[selected=true]:bg-white/10 data-[selected=true]:text-white"
                  >
                    <span className="flex-1 truncate">{country}</span>
                    <Check className={`h-4 w-4 shrink-0 ${selected.includes(country) ? "opacity-100" : "opacity-0"}`} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selected.map((country) => (
            <button
              key={country}
              type="button"
              onClick={() => onRemove(country)}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-sm text-slate-200 hover:bg-white/[0.1] transition-colors"
            >
              {country}
              <X className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SELECTION_MODE_LABELS: Record<"random" | "first_come" | "manual", string> = {
  random: "Random",
  first_come: "First come",
  manual: "I'll pick",
};

/** Whole-wizard draft, persisted to localStorage so a reload (or an accidental tab close)
 *  doesn't lose progress. Modeled as a single TanStack Query cache entry rather than a pile of
 *  useState — hydrated once from storage (or, in edit mode with nothing cached yet, from the
 *  backend) via queryFn, every update goes through updateDraft() below which patches the cache
 *  AND writes through to storage in the same call. */
interface GiveawayDraft {
  step: number;
  title: string;
  description: string;
  projectName: string;
  logoUrl: string;
  totalPool: number;
  winnerCount: number;
  selectionMode: "random" | "first_come" | "manual";
  rewardType: "usdc" | "megapot_ticket";
  entriesCloseAt: string;
  minFollowers: string;
  minAccountAgeDays: string;
  verifiedOnly: boolean;
  requiredCountries: string[];
  requiredContinents: string[];
  tasks: TaskRow[];
}

function defaultDraft(): GiveawayDraft {
  return {
    step: 1,
    title: "",
    description: "",
    projectName: "",
    logoUrl: "",
    totalPool: 500,
    winnerCount: 10,
    selectionMode: "random",
    rewardType: "usdc",
    entriesCloseAt: "",
    minFollowers: "",
    minAccountAgeDays: "",
    verifiedOnly: false,
    requiredCountries: [],
    requiredContinents: [],
    tasks: [newRow()],
  };
}

interface RemoteGiveaway {
  id: string;
  title: string;
  description: string | null;
  project_name: string | null;
  logo_url: string | null;
  winner_count: number;
  selection_mode: "random" | "first_come" | "manual";
  prize_amount_usd: string;
  reward_type?: "usdc" | "megapot_ticket";
  entries_close_at: string;
  eligibility: {
    min_followers?: number;
    min_account_age_days?: number;
    verified_only?: boolean;
    required_countries?: string[];
    required_continents?: string[];
  };
  status: string;
  tasks: Array<{ task_type: string; config: Record<string, any> }>;
}

function draftFromRemote(g: RemoteGiveaway): GiveawayDraft {
  const prizeAmount = parseFloat(g.prize_amount_usd || "0");
  return {
    step: 1,
    title: g.title,
    description: g.description ?? "",
    projectName: g.project_name ?? "",
    logoUrl: g.logo_url ?? "",
    totalPool: Math.max(MIN_TOTAL_POOL, Math.round(prizeAmount * g.winner_count)),
    winnerCount: g.winner_count,
    selectionMode: g.selection_mode,
    rewardType: g.reward_type ?? "usdc",
    entriesCloseAt: g.entries_close_at ? toLocalInputValue(new Date(g.entries_close_at)) : "",
    minFollowers: g.eligibility?.min_followers != null ? String(g.eligibility.min_followers) : "",
    minAccountAgeDays: g.eligibility?.min_account_age_days != null ? String(g.eligibility.min_account_age_days) : "",
    verifiedOnly: g.eligibility?.verified_only === true,
    requiredCountries: g.eligibility?.required_countries ?? [],
    requiredContinents: g.eligibility?.required_continents ?? [],
    tasks: collapseTasksToRows(g.tasks ?? []),
  };
}

async function loadDraft(
  storageKey: string,
  mode: "create" | "edit",
  giveawayId: string | undefined,
  getAccessToken: () => Promise<string | null>,
): Promise<GiveawayDraft> {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) return { ...defaultDraft(), ...JSON.parse(raw) };
    } catch {
      // corrupt cache entry — fall through
    }
  }
  if (mode === "edit" && giveawayId) {
    const token = await getAccessToken().catch(() => null);
    const res = await fetch(`${BACKEND_URL}/giveaways/${giveawayId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Giveaway not found, or you don't have access to edit it");
    const data: RemoteGiveaway = await res.json();
    if (!["DRAFT", "PENDING_APPROVAL", "PENDING_FUNDING"].includes(data.status)) {
      throw new Error(`This giveaway is ${data.status.replace(/_/g, " ").toLowerCase()} and can no longer be edited here — contact support for changes.`);
    }
    return draftFromRemote(data);
  }
  return defaultDraft();
}

export function GiveawayWizard({ mode, giveawayId }: { mode: "create" | "edit"; giveawayId?: string }) {
  const router = useRouter();
  const { authenticated } = useAuth();
  const { getAccessToken, login, user } = usePrivy();
  const { linkEmail } = useLinkAccount({});
  const notifyEmail = user?.email?.address ?? null;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [createAsAdmin, setCreateAsAdmin] = useState(false);
  // Brief glow on the live-preview card, and a brief pop on the stepper dot just finished, when
  // advancing a step — purely a "your changes landed" cue, no bearing on validation or submission.
  const [previewPulse, setPreviewPulse] = useState(false);
  const [justCompletedStep, setJustCompletedStep] = useState(0);

  // "Create as Loofta" is admin-only and create-only — the backend re-checks admin status itself
  // (never trusts this), this is purely to decide whether to show the toggle at all.
  const { data: isAdmin } = useQuery({
    queryKey: ["giveaway-wizard-is-admin"],
    queryFn: async (): Promise<boolean> => {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/admin/check", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) return false;
      const data = await res.json();
      return !!data.isAdmin;
    },
    enabled: authenticated && mode === "create",
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const storageKey = mode === "edit" && giveawayId ? `loofta:giveaway-draft:edit:${giveawayId}` : "loofta:giveaway-draft:v1";
  const queryKey = useMemo(() => ["giveaway-draft", mode, giveawayId ?? "new"] as const, [mode, giveawayId]);

  // The whole wizard's draft lives in one query-cache entry, hydrated once (from localStorage,
  // or — in edit mode with nothing cached yet — from the backend) and updated from then on
  // purely via updateDraft()'s setQueryData calls below. Same tool (@tanstack/react-query)
  // already used for server data elsewhere in this app, repurposed here as a persisted local store.
  const { data: draft = defaultDraft(), isLoading: draftLoading, error: draftError } = useQuery({
    queryKey,
    queryFn: () => loadDraft(storageKey, mode, giveawayId, getAccessToken),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const { step, title, description, projectName, logoUrl, totalPool, winnerCount, selectionMode, rewardType, entriesCloseAt, minFollowers, minAccountAgeDays, verifiedOnly, requiredCountries, requiredContinents, tasks } = draft;
  const prizeAmount = winnerCount > 0 ? totalPool / winnerCount : 0;
  const validWinnerCounts = useMemo(() => divisorsUpTo(totalPool, MAX_WINNERS), [totalPool]);

  const updateDraft = useCallback(
    (patch: Partial<GiveawayDraft> | ((prev: GiveawayDraft) => Partial<GiveawayDraft>)) => {
      queryClient.setQueryData<GiveawayDraft>(queryKey, (prev) => {
        const base = prev ?? defaultDraft();
        const next = { ...base, ...(typeof patch === "function" ? patch(base) : patch) };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // localStorage unavailable (private mode, quota) — draft just won't survive a reload
        }
        return next;
      });
    },
    [queryClient, queryKey, storageKey],
  );

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    queryClient.setQueryData(queryKey, defaultDraft());
  }, [queryClient, queryKey, storageKey]);

  const setStep = useCallback((next: number | ((prev: number) => number)) => {
    updateDraft((prev) => ({ step: typeof next === "function" ? next(prev.step) : next }));
  }, [updateDraft]);
  const setTitle = useCallback((v: string) => updateDraft({ title: v }), [updateDraft]);
  const setDescription = useCallback((v: string) => updateDraft({ description: v }), [updateDraft]);
  const setProjectName = useCallback((v: string) => updateDraft({ projectName: v }), [updateDraft]);

  const uploadLogo = useCallback(async (file: File) => {
    setUploadingLogo(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/giveaways/upload-logo", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Failed to upload logo");
      updateDraft({ logoUrl: body.logo_url });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not upload logo", description: err.message });
    } finally {
      setUploadingLogo(false);
    }
  }, [getAccessToken, updateDraft, toast]);
  const setSelectionMode = useCallback((v: GiveawayDraft["selectionMode"]) => updateDraft({ selectionMode: v }), [updateDraft]);
  const setRewardType = useCallback((v: GiveawayDraft["rewardType"]) => updateDraft({ rewardType: v }), [updateDraft]);
  const setEntriesCloseAt = useCallback((v: string) => updateDraft({ entriesCloseAt: v }), [updateDraft]);
  const setMinFollowers = useCallback((v: string) => updateDraft({ minFollowers: v }), [updateDraft]);
  const setMinAccountAgeDays = useCallback((v: string) => updateDraft({ minAccountAgeDays: v }), [updateDraft]);
  const setVerifiedOnly = useCallback((v: boolean) => updateDraft({ verifiedOnly: v }), [updateDraft]);
  const toggleContinent = useCallback((continent: Continent) => {
    updateDraft((prev) => ({
      requiredContinents: prev.requiredContinents.includes(continent)
        ? prev.requiredContinents.filter((c) => c !== continent)
        : [...prev.requiredContinents, continent],
    }));
  }, [updateDraft]);
  const addRequiredCountry = useCallback((country: string) => {
    updateDraft((prev) => (prev.requiredCountries.includes(country) ? prev : { requiredCountries: [...prev.requiredCountries, country] }));
  }, [updateDraft]);
  const removeRequiredCountry = useCallback((country: string) => {
    updateDraft((prev) => ({ requiredCountries: prev.requiredCountries.filter((c) => c !== country) }));
  }, [updateDraft]);

  const effectiveMinPool = createAsAdmin ? ADMIN_MIN_TOTAL_POOL : MIN_TOTAL_POOL;
  // Split in two so dragging the slider doesn't re-snap winnerCount on every intermediate tick
  // (visibly janky — the winners count would flicker through several values mid-drag). setTotalPool
  // just moves the pool value live; commitTotalPool does the winnerCount re-snap exactly once,
  // when the drag/keypress actually ends (see RangeSlider's onCommit).
  const setTotalPool = useCallback((next: number) => {
    const clamped = Math.min(MAX_TOTAL_POOL, Math.max(effectiveMinPool, Math.round(next) || effectiveMinPool));
    updateDraft({ totalPool: clamped });
  }, [updateDraft, effectiveMinPool]);
  const commitTotalPool = useCallback((next: number) => {
    const clamped = Math.min(MAX_TOTAL_POOL, Math.max(effectiveMinPool, Math.round(next) || effectiveMinPool));
    updateDraft((prev) => {
      const valid = divisorsUpTo(clamped, MAX_WINNERS);
      // Keep the current winner count if it still divides the new pool evenly; otherwise snap
      // to whichever valid count is closest, so per-winner never silently becomes a fraction.
      const winnerCount = valid.includes(prev.winnerCount) ? prev.winnerCount : nearest(valid, prev.winnerCount);
      return { totalPool: clamped, winnerCount };
    });
  }, [updateDraft, effectiveMinPool]);
  const setWinnerCount = useCallback((next: number) => {
    updateDraft((prev) => {
      const valid = divisorsUpTo(prev.totalPool, MAX_WINNERS);
      return { winnerCount: valid.includes(next) ? next : nearest(valid, next) };
    });
  }, [updateDraft]);

  // Free-typing buffers for the two number inputs — committing (clamp) on every keystroke made
  // the field fight the user mid-type. These hold whatever's actually typed; the real state only
  // commits on blur. Kept in sync when the committed value changes from the slider instead.
  const [totalPoolInput, setTotalPoolInput] = useState(String(totalPool));
  const [winnerCountInput, setWinnerCountInput] = useState(String(winnerCount));
  useEffect(() => setTotalPoolInput(String(totalPool)), [totalPool]);
  useEffect(() => setWinnerCountInput(String(winnerCount)), [winnerCount]);

  const addTask = useCallback(() => {
    updateDraft((prev) => ({ tasks: prev.tasks.length >= MAX_TASKS ? prev.tasks : [...prev.tasks, newRow()] }));
  }, [updateDraft]);
  const removeTask = useCallback((id: string) => {
    updateDraft((prev) => ({ tasks: prev.tasks.length <= 1 ? prev.tasks : prev.tasks.filter((r) => r.id !== id) }));
  }, [updateDraft]);
  const setTaskCategory = useCallback((id: string, category: TaskCategory) => {
    updateDraft((prev) => ({ tasks: prev.tasks.map((r) => (r.id === id ? { ...r, category, target: "" } : r)) }));
  }, [updateDraft]);
  const setTaskTarget = useCallback((id: string, target: string) => {
    updateDraft((prev) => ({ tasks: prev.tasks.map((r) => (r.id === id ? { ...r, target } : r)) }));
  }, [updateDraft]);
  const setTaskTitle = useCallback((id: string, title: string) => {
    updateDraft((prev) => ({ tasks: prev.tasks.map((r) => (r.id === id ? { ...r, title } : r)) }));
  }, [updateDraft]);
  const setTaskInstructions = useCallback((id: string, instructions: string) => {
    updateDraft((prev) => ({ tasks: prev.tasks.map((r) => (r.id === id ? { ...r, instructions } : r)) }));
  }, [updateDraft]);
  const setTaskRequiredText = useCallback((id: string, requiredText: string) => {
    updateDraft((prev) => ({ tasks: prev.tasks.map((r) => (r.id === id ? { ...r, requiredText } : r)) }));
  }, [updateDraft]);
  const toggleEngageAction = useCallback((id: string, action: keyof TaskRow["engage"]) => {
    updateDraft((prev) => ({
      tasks: prev.tasks.map((r) => (r.id === id ? { ...r, engage: { ...r.engage, [action]: !r.engage[action] } } : r)),
    }));
  }, [updateDraft]);
  const toggleRequireProof = useCallback((id: string) => {
    updateDraft((prev) => ({ tasks: prev.tasks.map((r) => (r.id === id ? { ...r, requireProof: !r.requireProof } : r)) }));
  }, [updateDraft]);

  const step1Valid = title.trim().length > 0;
  // Megapot tickets are $1 each and lottery_gifts caps a single gift at 100 tickets — prizeAmount
  // is already always a whole number here (winnerCount is snapped to a divisor of totalPool).
  const step2Valid = prizeAmount > 0 && winnerCount > 0 && totalPool >= effectiveMinPool
    && (rewardType !== "megapot_ticket" || prizeAmount <= 100);
  const step3Valid = tasks.every(rowIsValid);
  const step4Valid = Boolean(entriesCloseAt);

  const stepMeta = useMemo(
    () => [
      {
        icon: "/images/icons/giveaway-setup-icon.svg",
        title: "Name your giveaway",
        subtitle: "Watch it build itself in the preview as you type.",
      },
      {
        icon: "/images/icons/giveaway-prize-icon.svg",
        title: "How much are you giving?",
        subtitle: "Bigger pools reach further — the estimate updates live.",
      },
      {
        icon: "/images/icons/giveaway-tasks-icon.svg",
        title: "What do people do to enter?",
        subtitle: "Each task appears on the card instantly. Fewer tasks → more entries.",
      },
      {
        icon: null as string | null,
        title: "When does it close?",
        subtitle: "Shorter windows create urgency. One week is the sweet spot.",
      },
      {
        icon: "/images/icons/giveaway-launch-icon.svg",
        title: "Ready to launch",
        subtitle: "One last look — the preview card is exactly what goes live.",
      },
    ],
    [],
  );

  // TaskRow -> the small icon+label the live preview shows per task. "engage" rows collapse the
  // individually-checked actions (retweet/like/...) back into the one category label, matching
  // how a creator picked it, rather than exploding into several preview rows.
  const previewTasks: PreviewTask[] = useMemo(
    () =>
      tasks
        .filter(rowIsValid)
        .map((row) => ({
          icon: CATEGORY_ICONS[row.category],
          label: row.category === "custom" ? row.title.trim() || "Custom task" : CATEGORY_LABELS[row.category],
        })),
    [tasks],
  );

  const goNext = useCallback(() => {
    if (step === 1 && !step1Valid) {
      toast({ variant: "destructive", title: "Add a title first" });
      return;
    }
    if (step === 2 && !step2Valid) {
      toast({ variant: "destructive", title: `Total prize pool must be at least $${effectiveMinPool}` });
      return;
    }
    if (step === 3 && !step3Valid) {
      toast({ variant: "destructive", title: "Every task needs a target, and \"Engage with a post\" needs at least one action checked" });
      return;
    }
    if (step === 4 && !step4Valid) {
      toast({ variant: "destructive", title: "Set when entries close" });
      return;
    }
    setJustCompletedStep(step);
    setTimeout(() => setJustCompletedStep(0), 600);
    setPreviewPulse(true);
    setTimeout(() => setPreviewPulse(false), 700);
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }, [step, step1Valid, step2Valid, step3Valid, step4Valid, effectiveMinPool, toast]);

  const goBack = useCallback(() => setStep((s) => Math.max(1, s - 1)), []);

  const handleSubmit = useCallback(async () => {
    if (mode === "create" && !notifyEmail) {
      toast({ variant: "destructive", title: "Add your email first", description: "We need an email on file to notify you about approval, funding, and payouts." });
      return;
    }
    setSubmitting(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const url = mode === "edit" && giveawayId ? `${BACKEND_URL}/giveaways/${giveawayId}` : `${BACKEND_URL}/giveaways`;
      const res = await fetch(url, {
        method: mode === "edit" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          project_name: projectName.trim() || undefined,
          logo_url: logoUrl || undefined,
          winner_count: winnerCount,
          selection_mode: selectionMode,
          prize_amount_usd: prizeAmount,
          reward_type: rewardType,
          entries_close_at: new Date(entriesCloseAt).toISOString(),
          eligibility: {
            ...(minFollowers ? { min_followers: Number(minFollowers) } : {}),
            ...(minAccountAgeDays ? { min_account_age_days: Number(minAccountAgeDays) } : {}),
            ...(verifiedOnly ? { verified_only: true } : {}),
            ...(requiredCountries.length ? { required_countries: requiredCountries } : {}),
            ...(requiredContinents.length ? { required_continents: requiredContinents } : {}),
          },
          tasks: tasks.flatMap(expandTaskRow),
          ...(mode === "create" ? { is_official: createAsAdmin } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || (mode === "edit" ? "Failed to save changes" : "Failed to submit giveaway"));
      }
      setSubmitted(true);
      if (mode === "create" && process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
        posthog.capture("giveaway_created", {
          prize_pool_usd: totalPool,
          winner_count: winnerCount,
          selection_mode: selectionMode,
          task_count: tasks.length,
          is_official: createAsAdmin,
        });
      }
      clearDraft();
      // Without this, a "mine" list fetched within the last staleTime window (15s) serves its
      // cached pre-creation snapshot straight from cache on navigation — the new giveaway looks
      // missing until an unrelated refetch happens to fire or the page is manually reloaded.
      queryClient.invalidateQueries({ queryKey: ["giveaways-mine"] });
      const redirectTo = mode === "edit" && giveawayId ? `/rewards/giveaways/${giveawayId}` : "/rewards/giveaways/mine";
      setTimeout(() => router.push(redirectTo), 1800);
    } catch (err: any) {
      toast({ variant: "destructive", title: mode === "edit" ? "Failed to save changes" : "Failed to submit giveaway", description: err.message });
    } finally {
      setSubmitting(false);
    }
  }, [mode, giveawayId, notifyEmail, title, description, projectName, logoUrl, totalPool, winnerCount, selectionMode, rewardType, prizeAmount, entriesCloseAt, minFollowers, minAccountAgeDays, verifiedOnly, requiredCountries, requiredContinents, tasks, createAsAdmin, getAccessToken, router, toast, clearDraft, queryClient]);

  const backHref = mode === "edit" && giveawayId ? `/rewards/giveaways/${giveawayId}` : "/rewards/giveaways";
  const backLabel = mode === "edit" ? "Back to giveaway" : "Back to giveaways";
  // The live-preview column only makes sense once there's a form on screen to preview — narrower
  // single-column width for the sign-in gate, loading/error states, and the post-submit screen.
  const showPreviewColumn = authenticated && !(mode === "edit" && (draftLoading || draftError)) && !submitted;

  return (
    <>
      <div className="bg-[#0a0a0c]">
        <div className={`mx-auto px-4 pt-4 pb-2 ${showPreviewColumn ? "max-w-[1200px]" : "max-w-lg"}`}>
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-base text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
            <span>{backLabel}</span>
          </Link>
        </div>
      </div>

      <div className="relative min-h-[calc(100vh-var(--header-h,0px))] overflow-x-hidden bg-[#0a0a0c] text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-300px] h-[500px] w-[900px] -translate-x-1/2 rounded-full opacity-[0.12] blur-[140px]"
          style={{ background: "radial-gradient(ellipse, #FF1301, transparent 65%)" }}
        />
        <div className={`relative mx-auto px-4 py-6 pb-24 ${showPreviewColumn ? "max-w-[1200px]" : "max-w-lg"}`}>
          {!authenticated ? (
            <div className="rounded-2xl border border-white/15 bg-white/[0.06] shadow-2xl p-8 text-center">
              <p className="text-base text-slate-300 mb-4">Sign in to {mode === "edit" ? "edit this giveaway" : "launch a giveaway"}.</p>
              <GradientActionButton onClick={() => login({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false })}>
                <span className="text-base">Sign in</span>
              </GradientActionButton>
            </div>
          ) : mode === "edit" && draftLoading ? (
            <div className="rounded-2xl border border-white/15 bg-white/[0.06] shadow-2xl p-8 animate-pulse">
              <div className="h-24 rounded-xl bg-white/5" />
            </div>
          ) : mode === "edit" && draftError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
              <p className="text-red-400 text-base">{(draftError as Error).message}</p>
              <Link href={backHref} className="mt-3 inline-block text-base text-slate-400 hover:text-white underline">
                Back to giveaway
              </Link>
            </div>
          ) : (
            <div className={showPreviewColumn ? "grid grid-cols-1 lg:grid-cols-[1.15fr_.85fr] gap-8 lg:gap-12 items-start" : ""}>
            <div className="rounded-3xl border border-white/10 bg-white/[0.05] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] p-6">
              {submitted ? (
                <div className="py-10 text-center">
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    className="mb-4 flex justify-center"
                  >
                    <Image src="/images/icons/giveaway-prize-icon.svg" alt="" width={72} height={72} />
                  </motion.div>
                  <motion.p
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="text-2xl font-medium text-white"
                  >
                    {mode === "edit" ? "Changes saved!" : "Submitted for approval!"}
                  </motion.p>
                  <p className="text-base text-slate-400 mt-2">
                    {mode === "edit" ? "Taking you back to your giveaway…" : "Taking you to My Giveaways…"}
                  </p>
                </div>
              ) : (
                <>
                  <StepDots step={step} justCompleted={justCompletedStep} />
                  <h1 className="font-display text-[32px] font-medium tracking-[-0.025em] text-white mb-2 flex items-center gap-3">
                    {stepMeta[step - 1].icon && (
                      <Image src={stepMeta[step - 1].icon!} alt="" width={30} height={30} className="shrink-0" />
                    )}
                    {stepMeta[step - 1].title}
                  </h1>
                  <p className="font-grotesk text-[15px] text-slate-400 mb-7">{stepMeta[step - 1].subtitle}</p>

                  <AnimatePresence mode="wait">
                    <motion.div
                      key={step}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-4"
                    >
                      {step === 1 && (
                        <>
                          {isAdmin && mode === "create" && (
                            <button
                              type="button"
                              onClick={() => setCreateAsAdmin((v) => !v)}
                              className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                                createAsAdmin ? "border-[#FF7A2A]/40 bg-[#FF7A2A]/10" : "border-white/10 bg-white/[0.03]"
                              }`}
                            >
                              <span className="flex items-center gap-2 text-left">
                                <Image src="/loofta_icon_magic.png" alt="" width={20} height={20} className="rounded-full shrink-0" />
                                <span className={`text-base font-medium ${createAsAdmin ? "text-white" : "text-slate-300"}`}>
                                  Create as Loofta (admin)
                                  <span className="block text-sm font-normal text-slate-500">
                                    Auto-approved, pinned to the top, prize pool as low as ${ADMIN_MIN_TOTAL_POOL} for testing
                                  </span>
                                </span>
                              </span>
                              <span className={`shrink-0 w-10 h-6 rounded-full border transition-colors relative ${
                                createAsAdmin ? "bg-[#FF7A2A] border-[#FF7A2A]" : "bg-white/10 border-white/15"
                              }`}>
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${createAsAdmin ? "left-[18px]" : "left-0.5"}`} />
                              </span>
                            </button>
                          )}
                          <div>
                            <Label className={labelClass}>Title</Label>
                            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Launch Week Giveaway" className={inputClass} />
                          </div>
                          <div>
                            <FieldLabel optional>Description</FieldLabel>
                            <RichTextEditor value={description} onChange={setDescription} rows={6}
                              maxLength={2000} placeholder="What is this giveaway for?" />
                          </div>
                          <div>
                            <FieldLabel optional>Project name</FieldLabel>
                            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Your project or brand name" className={inputClass} />
                          </div>
                          <div>
                            <FieldLabel optional>Project logo</FieldLabel>
                            <label
                              className={`flex items-center gap-3.5 rounded-xl px-4 py-3.5 cursor-pointer transition-colors ${
                                logoUrl ? "border border-emerald-400/35 bg-emerald-400/[0.06]" : "border border-dashed border-white/20 bg-white/[0.03] hover:bg-white/[0.06]"
                              } ${uploadingLogo ? "opacity-60 pointer-events-none" : ""}`}
                            >
                              {logoUrl ? (
                                <Image src={logoUrl} alt="" width={44} height={44} className="rounded-lg object-cover border border-white/10 shrink-0" />
                              ) : (
                                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.06] shrink-0">
                                  <ImagePlus className="w-5 h-5 text-slate-400" />
                                </div>
                              )}
                              <div className={`text-base ${logoUrl ? "text-emerald-400" : "text-slate-400"}`}>
                                {uploadingLogo ? "Uploading…" : logoUrl ? "Logo added — click to change" : "Upload your logo"}
                                <span className="block text-sm text-slate-500 mt-0.5">Square works best — you&apos;ll get to crop it next</span>
                              </div>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={uploadingLogo}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) setPendingLogoFile(file);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            <p className="text-sm text-slate-500 mt-1">
                              Shown as a badge next to your project name on the giveaway page, alongside the Loofta badge.
                            </p>
                          </div>
                        </>
                      )}

                      {step === 2 && (
                        <>
                          <div>
                            <Label className={labelClass}>Prize type</Label>
                            <div className="flex gap-2">
                              {(["usdc", "megapot_ticket"] as const).map((rt) => (
                                <button
                                  key={rt}
                                  type="button"
                                  onClick={() => setRewardType(rt)}
                                  className={`flex-1 rounded-xl px-3 py-3 text-base font-medium border transition-all ${
                                    rewardType === rt ? "border-[#FF7A2A] text-white" : "border-white/15 text-slate-300 hover:bg-white/[0.06]"
                                  }`}
                                >
                                  {rt === "usdc" ? "USDC" : "Megapot tickets"}
                                </button>
                              ))}
                            </div>
                            <p className="text-sm text-slate-500 mt-1.5">
                              {rewardType === "usdc"
                                ? "Winners get a normal USDC claim link."
                                : "Winners get that many dollars' worth of Megapot tickets, gifted automatically at payout — capped at $100 (100 tickets) per winner."}
                            </p>
                          </div>

                          <div>
                            <Label className={labelClass}>Total prize pool</Label>
                            <RangeSlider min={effectiveMinPool} max={MAX_TOTAL_POOL} step={10} value={totalPool} onChange={setTotalPool} onCommit={commitTotalPool} />
                            <div className="relative mt-2">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">$</span>
                              <Input
                                type="number"
                                value={totalPoolInput}
                                onChange={(e) => setTotalPoolInput(e.target.value)}
                                onBlur={() => commitTotalPool(Number(totalPoolInput))}
                                className={`${inputClass} pl-7`}
                              />
                            </div>
                            {!createAsAdmin && (
                              <p className="text-sm text-slate-500 mt-1.5">
                                Plus a flat $5 platform fee to launch — you&apos;ll fund ${totalPool + 5} total.
                              </p>
                            )}
                          </div>

                          <div>
                            <Label className={labelClass}>Number of winners</Label>
                            <RangeSlider
                              min={0}
                              max={Math.max(0, validWinnerCounts.length - 1)}
                              step={1}
                              value={Math.max(0, validWinnerCounts.indexOf(winnerCount))}
                              onChange={(idx) => setWinnerCount(validWinnerCounts[idx] ?? validWinnerCounts[0])}
                            />
                            <Input
                              type="number"
                              value={winnerCountInput}
                              onChange={(e) => setWinnerCountInput(e.target.value)}
                              onBlur={() => setWinnerCount(Number(winnerCountInput))}
                              className={`${inputClass} mt-2`}
                            />
                            <p className="text-sm text-slate-500 mt-1.5">
                              Only counts that split ${totalPool} evenly are selectable{validWinnerCounts.length <= 8 ? `: ${validWinnerCounts.join(", ")}` : ""}.
                            </p>
                          </div>

                          <div className="rounded-xl border border-white/15 bg-white/[0.04] p-3 flex items-center justify-between">
                            <span className={helperClass}>Prize per winner</span>
                            <span className="text-xl font-medium text-white">
                              ${prizeAmount}{rewardType === "megapot_ticket" ? ` = ${prizeAmount} ticket${prizeAmount === 1 ? "" : "s"}` : ""}
                            </span>
                          </div>
                          {rewardType === "megapot_ticket" && prizeAmount > 100 && (
                            <p className="text-sm text-red-400 -mt-3">
                              Ticket prizes are capped at $100 per winner — lower the pool or add more winners.
                            </p>
                          )}

                          <div>
                            <Label className={labelClass}>Winner selection</Label>
                            <div className="flex gap-2">
                              {(["random", "first_come", "manual"] as const).map((mode2) => (
                                <button
                                  key={mode2}
                                  type="button"
                                  onClick={() => setSelectionMode(mode2)}
                                  className={`flex-1 rounded-xl px-3 py-3 text-base font-medium border transition-all ${
                                    selectionMode === mode2 ? "border-[#FF7A2A] text-white" : "border-white/15 text-slate-300 hover:bg-white/[0.06]"
                                  }`}
                                >
                                  {SELECTION_MODE_LABELS[mode2]}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}

                      {step === 3 && (
                        <>
                          <p className={helperClass}>
                            Pick from the task catalog below. X tasks are verified automatically — everything else is reviewed by you.
                          </p>
                          <div className="space-y-3">
                            {tasks.map((task, idx) => (
                              <div key={task.id} className="rounded-xl border border-white/15 bg-white/[0.04] p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-base font-medium text-slate-300">Task {idx + 1}</span>
                                  {tasks.length > 1 && (
                                    <button type="button" onClick={() => removeTask(task.id)} className="text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg p-1.5 transition-colors">
                                      <X className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  {(Object.keys(CATEGORY_LABELS) as TaskCategory[]).map((cat) => (
                                    <button
                                      key={cat}
                                      type="button"
                                      onClick={() => setTaskCategory(task.id, cat)}
                                      className={`rounded-xl px-3 py-2.5 text-base font-medium border transition-all ${
                                        task.category === cat ? "border-[#FF7A2A] text-white" : "border-white/15 text-slate-300 hover:bg-white/[0.06]"
                                      }`}
                                    >
                                      {CATEGORY_LABELS[cat]}
                                    </button>
                                  ))}
                                </div>

                                {task.category === "custom" ? (
                                  <>
                                    <Input
                                      value={task.title}
                                      onChange={(e) => setTaskTitle(task.id, e.target.value)}
                                      placeholder="Task title — e.g. Join the stream, Join waitlist, Create an account"
                                      className={inputClass}
                                    />
                                    <Input
                                      value={task.target}
                                      onChange={(e) => setTaskTarget(task.id, e.target.value)}
                                      placeholder={CATEGORY_TARGET_LABELS.custom}
                                      className={inputClass}
                                    />
                                  </>
                                ) : task.category === "x_post" ? (
                                  <>
                                    <RequiredTextField
                                      value={task.requiredText ?? ""}
                                      onChange={(v) => setTaskRequiredText(task.id, v)}
                                    />
                                    <p className="text-sm text-slate-500">
                                      Entrants get a one-click pre-filled post with this exact text — verified automatically against X.
                                    </p>
                                  </>
                                ) : (
                                  <Input
                                    value={task.target}
                                    onChange={(e) => setTaskTarget(task.id, e.target.value)}
                                    placeholder={CATEGORY_TARGET_LABELS[task.category]}
                                    className={inputClass}
                                  />
                                )}

                                {SELF_REPORT_CATEGORIES.has(task.category) && (
                                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                                    <button
                                      type="button"
                                      onClick={() => toggleRequireProof(task.id)}
                                      className={`w-full flex items-center justify-between gap-3 text-left text-base font-medium transition-colors ${
                                        task.requireProof ? "text-white" : "text-slate-300"
                                      }`}
                                    >
                                      <span>Require proof of completion</span>
                                      <span
                                        className={`shrink-0 w-10 h-6 rounded-full border transition-colors relative ${
                                          task.requireProof ? "bg-[#FF7A2A] border-[#FF7A2A]" : "bg-white/10 border-white/15"
                                        }`}
                                      >
                                        <span
                                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${task.requireProof ? "left-[18px]" : "left-0.5"}`}
                                        />
                                      </span>
                                    </button>
                                    <p className="text-sm text-slate-500 mt-1.5">Ask entrants to submit a screenshot or a link</p>
                                  </div>
                                )}

                                {task.category === "engage" && (
                                  <>
                                    <div className="flex flex-wrap gap-2">
                                      {ENGAGE_ACTIONS.map((action) => (
                                        <button
                                          key={action.key}
                                          type="button"
                                          onClick={() => toggleEngageAction(task.id, action.key)}
                                          className={`rounded-full px-3.5 py-1.5 text-base font-medium border transition-all ${
                                            task.engage[action.key] ? "border-[#FF7A2A] text-white" : "border-white/15 text-slate-400 hover:bg-white/[0.06]"
                                          }`}
                                        >
                                          {action.label}
                                        </button>
                                      ))}
                                    </div>
                                    {task.engage.bookmark && (
                                      <p className="text-sm text-slate-500">
                                        Bookmark can&apos;t be auto-verified (X has no public API for it) — you&apos;ll review it manually.
                                      </p>
                                    )}
                                    <Input
                                      value={task.instructions}
                                      onChange={(e) => setTaskInstructions(task.id, e.target.value)}
                                      placeholder="Instructions (optional) — e.g. what the comment should mention"
                                      className={inputClass}
                                    />
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={addTask}
                            disabled={tasks.length >= MAX_TASKS}
                            className="inline-flex items-center gap-1.5 text-base font-medium border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all rounded-xl px-3 py-2 disabled:opacity-40"
                          >
                            <Plus className="w-4 h-4" /> Add another task
                          </button>
                        </>
                      )}

                      {step === 4 && (
                        <>
                          <div>
                            <Label className={labelClass}>Entries close at</Label>
                            <DateTimePicker value={entriesCloseAt} onChange={setEntriesCloseAt} />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <FieldLabel optional>Min X followers</FieldLabel>
                              <Input type="number" min="0" value={minFollowers} onChange={(e) => setMinFollowers(e.target.value)} className={inputClass} placeholder="e.g. 100" />
                            </div>
                            <div>
                              <FieldLabel optional>Min X account age</FieldLabel>
                              <Input type="number" min="0" value={minAccountAgeDays} onChange={(e) => setMinAccountAgeDays(e.target.value)} className={inputClass} placeholder="e.g. 30 days" />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setVerifiedOnly(!verifiedOnly)}
                            className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                              verifiedOnly ? "border-[#FF7A2A]/40 bg-[#FF7A2A]/10" : "border-white/10 bg-white/[0.03]"
                            }`}
                          >
                            <span className="text-left">
                              <span className={`text-base font-medium ${verifiedOnly ? "text-white" : "text-slate-300"}`}>Require verified X account</span>
                              <span className="block text-sm font-normal text-slate-500">Only entrants with X's verified badge can enter</span>
                            </span>
                            <span className={`shrink-0 w-10 h-6 rounded-full border transition-colors relative ${
                              verifiedOnly ? "bg-[#FF7A2A] border-[#FF7A2A]" : "bg-white/10 border-white/15"
                            }`}>
                              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${verifiedOnly ? "left-[18px]" : "left-0.5"}`} />
                            </span>
                          </button>

                          <div>
                            <FieldLabel optional>Continents</FieldLabel>
                            <div className="flex flex-wrap gap-2">
                              {CONTINENTS.map((continent) => (
                                <button
                                  key={continent}
                                  type="button"
                                  onClick={() => toggleContinent(continent)}
                                  className={`rounded-full px-3.5 py-1.5 text-base font-medium border transition-all ${
                                    requiredContinents.includes(continent) ? "border-[#FF7A2A] text-white" : "border-white/15 text-slate-400 hover:bg-white/[0.06]"
                                  }`}
                                >
                                  {continent}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <FieldLabel optional>Specific countries</FieldLabel>
                            <CountryMultiSelect selected={requiredCountries} onAdd={addRequiredCountry} onRemove={removeRequiredCountry} />
                            <p className="text-sm text-slate-500 mt-1.5">
                              Entrants qualify if their X account&apos;s region matches either a selected continent or a selected country.
                            </p>
                          </div>
                        </>
                      )}

                      {step === 5 && (
                        <>
                          <div className="rounded-xl border border-white/15 bg-white/[0.04] p-5 space-y-1.5">
                            <p className="text-2xl font-medium text-white truncate">{title}</p>
                            <p className="text-base text-slate-300">
                              ${totalPool} total · {rewardType === "megapot_ticket" ? `${prizeAmount} ticket${prizeAmount === 1 ? "" : "s"}` : `$${prizeAmount}`} × {winnerCount} winner{winnerCount === 1 ? "" : "s"} · {SELECTION_MODE_LABELS[selectionMode]}
                            </p>
                            <p className="text-base text-slate-500">
                              Closes {entriesCloseAt ? new Date(entriesCloseAt).toLocaleDateString() : "—"} · {tasks.length} task{tasks.length === 1 ? "" : "s"}
                            </p>
                          </div>

                          <div>
                            <Label className={labelClass}>Email{mode === "create" ? " (required)" : ""}</Label>
                            {notifyEmail ? (
                              <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5">
                                <Mail className="w-4 h-4 text-slate-500 shrink-0" />
                                <p className="text-base text-slate-400">We&apos;ll email {notifyEmail} about approval, funding, and payouts.</p>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => linkEmail()}
                                className="w-full flex items-center gap-2 rounded-xl bg-[#FF7A2A]/10 border border-[#FF7A2A]/40 px-3 py-2.5 hover:bg-[#FF7A2A]/15 transition-colors text-left"
                              >
                                <Mail className="w-4 h-4 text-[#FF7A2A] shrink-0" />
                                <p className="text-base font-medium text-white">
                                  {mode === "create" ? "Add your email to submit — we need it to notify you" : "Add your email to be notified about updates"}
                                </p>
                              </button>
                            )}
                          </div>

                          <p className={helperClass}>
                            Loofta reviews every giveaway before it opens for entries. Once approved, budget or task changes go through support —
                            there&apos;s no self-service edit after this.
                          </p>
                        </>
                      )}
                    </motion.div>
                  </AnimatePresence>

                  <div className="mt-6 space-y-3">
                    {step < TOTAL_STEPS ? (
                      <GradientActionButton onClick={goNext}>
                        <span className="text-base">Continue</span>
                      </GradientActionButton>
                    ) : (
                      <GradientActionButton
                        onClick={handleSubmit}
                        disabled={mode === "create" && !notifyEmail}
                        loading={submitting}
                        loadingText={mode === "edit" ? "Saving…" : "Submitting…"}
                      >
                        <span className="text-base">{mode === "edit" ? "Save changes" : "Submit for approval"}</span>
                      </GradientActionButton>
                    )}
                    {step > 1 && (
                      <button type="button" onClick={goBack} className="block w-full text-center text-base font-semibold text-slate-400 hover:text-white transition-colors py-1">
                        ← Back
                      </button>
                    )}
                  </div>
                </>
              )}
              </div>
              {showPreviewColumn && (
                <GiveawayLivePreview
                  title={title}
                  projectName={projectName}
                  logoUrl={logoUrl}
                  description={description}
                  totalPool={totalPool}
                  winnerCount={winnerCount}
                  selectionMode={selectionMode}
                  rewardType={rewardType}
                  entriesCloseAt={entriesCloseAt}
                  minFollowers={minFollowers}
                  verifiedOnly={verifiedOnly}
                  requiredCountries={requiredCountries}
                  requiredContinents={requiredContinents}
                  isOfficial={mode === "create" && createAsAdmin}
                  tasks={previewTasks}
                  pulse={previewPulse}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {pendingLogoFile && (
        <LogoCropModal
          file={pendingLogoFile}
          onCancel={() => setPendingLogoFile(null)}
          onConfirm={(blob) => {
            setPendingLogoFile(null);
            uploadLogo(new File([blob], "logo.png", { type: "image/png" }));
          }}
        />
      )}

      <style jsx global>{`
        @keyframes g-pop {
          0% { transform: scale(1); }
          40% { transform: scale(1.35); }
          100% { transform: scale(1); }
        }
      `}</style>
    </>
  );
}
