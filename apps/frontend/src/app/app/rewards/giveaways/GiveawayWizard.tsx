"use client";
import { clientApiBase } from "@/services/api/client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { X, Calendar as CalendarGlyph, Check, Smile, ChevronDown } from "lucide-react";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy, useLinkAccount } from "@privy-io/react-auth";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { LogoCropModal } from "@/components/LogoCropModal";
import { CONTINENTS, COUNTRIES, type Continent } from "@/lib/countries";
import { sora, manrope, jetbrainsMono } from "@/components/home-v4/fonts";
import "@/components/app-home/loofta-app.css";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import posthog from "posthog-js";

const BACKEND_URL = clientApiBase();
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

function newRow(category: TaskCategory = "x_follow"): TaskRow {
  return {
    id: crypto.randomUUID(),
    category,
    target: "",
    title: "",
    instructions: "",
    requiredText: "",
    requireProof: false,
    engage: { retweet: true, like: true, comment: false, bookmark: false },
  };
}

function rowIsValid(row: TaskRow): boolean {
  if (row.category === "custom") return (row.title ?? "").trim().length > 0;
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
    const config: Record<string, unknown> = { title: (row.title ?? "").trim() };
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
  const parsedDate = value ? new Date(value) : undefined;
  const selectedDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : undefined;
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
    if (Number.isNaN(h) || Number.isNaN(m)) return;
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
  random: "Random draw",
  first_come: "First come",
  manual: "I'll pick",
};

const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";
const FIELD: CSSProperties = {
  background: "#0E0E12",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  outline: "none",
  color: "#F2EFE8",
  fontSize: 15,
  padding: "13px 14px",
  minWidth: 0,
  width: "100%",
  fontWeight: 600,
};
const CARD: CSSProperties = {
  padding: 22,
  borderRadius: 24,
  background: "#141419",
  border: "1px solid rgba(255,255,255,0.07)",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

function usd(n: number) {
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function taskPreviewLabel(row: TaskRow): string {
  if (row.category === "custom") return (row.title ?? "").trim() || "Custom task";
  if (row.category === "x_follow") {
    const handle = row.target.trim().replace(/^@/, "");
    return handle ? `Follow @${handle} on X` : "Follow on X";
  }
  if (row.category === "x_post") return (row.requiredText ?? "").trim() ? "Post the required text on X" : "Post on X";
  if (row.category === "engage") {
    const bits = [
      row.engage.like && "like",
      row.engage.retweet && "repost",
      row.engage.comment && "comment",
      row.engage.bookmark && "bookmark",
    ].filter(Boolean) as string[];
    if (!bits.length) return "Engage with a post";
    const phrase = bits.join(", ").replace(/, ([^,]*)$/, " and $1");
    return `${phrase[0].toUpperCase()}${phrase.slice(1)} the post`;
  }
  return CATEGORY_LABELS[row.category];
}

function TokenLogo({ mint, size = 28 }: { mint: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <img src="/images/sol.png" alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "contain" }} />;
  }
  return (
    <img
      src={`/api/giveaways/token-icon?mint=${encodeURIComponent(mint)}`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: 999, objectFit: "cover", background: "#1A1A22" }}
    />
  );
}

function Fold({
  title,
  hint,
  open,
  onToggle,
  children,
}: {
  title: string;
  hint: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div style={open ? CARD : { borderRadius: 24, background: "#141419", border: "1px solid rgba(255,255,255,0.07)" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ cursor: "pointer", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: open ? 0 : "18px 22px", background: "transparent", border: 0, color: "#F2EFE8", textAlign: "left" }}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 18 }}>{title}</span>
          {!open && <span style={{ fontSize: 13, fontWeight: 500, color: "#77757F" }}>{hint}</span>}
        </span>
        <ChevronDown size={18} color="#FF7A2A" style={{ flex: "none", transform: open ? "rotate(180deg)" : undefined, transition: "transform 160ms ease" }} />
      </button>
      {open ? children : null}
    </div>
  );
}

function XMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function TaskGlyph({ category, size = 16 }: { category: TaskCategory; size?: number }) {
  if (category === "telegram_join") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden>
        <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
      </svg>
    );
  }
  if (category === "discord_join") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden>
        <path d="M20.3 4.4a19.8 19.8 0 0 0-4.9-1.5.1.1 0 0 0-.1 0c-.2.4-.4.9-.6 1.3a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.6-1.3.1.1 0 0 0-.1 0A19.7 19.7 0 0 0 3.7 4.4a.1.1 0 0 0 0 0C.5 9-.3 13.6.1 18.1a.1.1 0 0 0 0 .1 19.9 19.9 0 0 0 6 3 .1.1 0 0 0 .1 0c.5-.6.9-1.3 1.2-2a.1.1 0 0 0 0-.1 13 13 0 0 1-1.9-.9.1.1 0 0 1 0-.1l.4-.3a.1.1 0 0 1 .1 0c3.9 1.8 8.2 1.8 12 0a.1.1 0 0 1 .1 0l.4.3a.1.1 0 0 1 0 .1 12.3 12.3 0 0 1-1.9.9.1.1 0 0 0 0 .1c.4.7.8 1.4 1.2 2a.1.1 0 0 0 .1 0 19.8 19.8 0 0 0 6-3 .1.1 0 0 0 0-.1c.5-5.2-.8-9.7-3.5-13.7a.1.1 0 0 0 0 0zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4c0 1.3-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4c0 1.3-1 2.4-2.2 2.4z" />
      </svg>
    );
  }
  if (category === "custom") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  return <XMark />;
}

function taskTile(category: TaskCategory) {
  if (category === "telegram_join") return "#229ED9";
  if (category === "discord_join") return "#5865F2";
  if (category === "custom") return "#FF5A1A";
  return "#000";
}

const ADD_TASKS: Array<{ category: TaskCategory; label: string }> = [
  { category: "x_follow", label: "Follow on X" },
  { category: "engage", label: "Engage with a post" },
  { category: "x_post", label: "Post on X" },
  { category: "telegram_join", label: "Join Telegram" },
  { category: "discord_join", label: "Join Discord" },
  { category: "custom", label: "Custom task" },
];

/** Whole-wizard draft, persisted to localStorage so a reload (or an accidental tab close)
 *  doesn't lose progress. Modeled as a single TanStack Query cache entry rather than a pile of
 *  useState — hydrated once from storage (or, in edit mode with nothing cached yet, from the
 *  backend) via queryFn, every update goes through updateDraft() below which patches the cache
 *  AND writes through to storage in the same call. */
interface PrizeToken {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  decimals: number;
  usdPrice: number | null;
}

interface GiveawayDraft {
  step: number;
  title: string;
  description: string;
  projectName: string;
  logoUrl: string;
  totalPool: number;
  winnerCount: number;
  selectionMode: "random" | "first_come" | "manual";
  rewardType: "usdc" | "megapot_ticket" | "token";
  prizeToken: PrizeToken | null;
  entriesCloseAt: string;
  minFollowers: string;
  minAccountAgeDays: string;
  verifiedOnly: boolean;
  requiredCountries: string[];
  requiredContinents: string[];
  excludedCountries: string[];
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
    prizeToken: null,
    entriesCloseAt: "",
    minFollowers: "",
    minAccountAgeDays: "",
    verifiedOnly: false,
    requiredCountries: [],
    requiredContinents: [],
    excludedCountries: [],
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
  prize_mint?: string | null;
  prize_token_symbol?: string | null;
  prize_token_name?: string | null;
  prize_token_logo?: string | null;
  prize_token_decimals?: number | null;
  entries_close_at: string;
  eligibility: {
    min_followers?: number;
    min_account_age_days?: number;
    verified_only?: boolean;
    required_countries?: string[];
    required_continents?: string[];
    excluded_countries?: string[];
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
    rewardType: g.prize_mint ? "token" : (g.reward_type ?? "usdc"),
    prizeToken: g.prize_mint
      ? {
          mint: g.prize_mint,
          symbol: g.prize_token_symbol || "Token",
          name: g.prize_token_name || "Solana token",
          logo: g.prize_token_logo ?? null,
          decimals: g.prize_token_decimals ?? 0,
          usdPrice: null,
        }
      : null,
    entriesCloseAt: g.entries_close_at ? toLocalInputValue(new Date(g.entries_close_at)) : "",
    minFollowers: g.eligibility?.min_followers != null ? String(g.eligibility.min_followers) : "",
    minAccountAgeDays: g.eligibility?.min_account_age_days != null ? String(g.eligibility.min_account_age_days) : "",
    verifiedOnly: g.eligibility?.verified_only === true,
    requiredCountries: g.eligibility?.required_countries ?? [],
    requiredContinents: g.eligibility?.required_continents ?? [],
    excludedCountries: g.eligibility?.excluded_countries ?? [],
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
      if (raw) {
        const parsed = { ...defaultDraft(), ...JSON.parse(raw) } as GiveawayDraft;
        // Rows persisted before newer fields (title, requiredText, ...) existed lack them, and
        // string methods on undefined crash the render — backfill every row from newRow().
        const tasks = Array.isArray(parsed.tasks) && parsed.tasks.length > 0 ? parsed.tasks : [newRow()];
        parsed.tasks = tasks.map((r) => {
          const base = newRow();
          return { ...base, ...r, engage: { ...base.engage, ...(r?.engage ?? {}) } };
        });
        return parsed;
      }
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
  const { step, title, description, projectName, logoUrl, totalPool, winnerCount, selectionMode, rewardType, prizeToken, entriesCloseAt, minFollowers, minAccountAgeDays, verifiedOnly, requiredCountries, requiredContinents, excludedCountries, tasks } = draft;
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
  const addExcludedCountry = useCallback((country: string) => {
    updateDraft((prev) => (prev.excludedCountries.includes(country) ? prev : { excludedCountries: [...prev.excludedCountries, country] }));
  }, [updateDraft]);
  const removeExcludedCountry = useCallback((country: string) => {
    updateDraft((prev) => ({ excludedCountries: prev.excludedCountries.filter((c) => c !== country) }));
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
    && (rewardType !== "megapot_ticket" || prizeAmount <= 100)
    && (rewardType !== "token" || Boolean(prizeToken?.mint));
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
  const previewTasks = useMemo(
    () => tasks.filter(rowIsValid).map((row) => ({ category: row.category, label: taskPreviewLabel(row) })),
    [tasks],
  );

  const [prizeOpen, setPrizeOpen] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [closePreset, setClosePreset] = useState<"24h" | "3d" | "1w" | "2w" | "custom">("1w");
  const closeInit = useRef(false);
  useEffect(() => {
    if (closeInit.current || draftLoading) return;
    closeInit.current = true;
    if (!draft.entriesCloseAt) {
      setClosePreset("1w");
      setEntriesCloseAt(toLocalInputValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
    } else {
      setClosePreset("custom");
    }
  }, [draft.entriesCloseAt, draftLoading, setEntriesCloseAt]);

  const applyClosePreset = useCallback((preset: "24h" | "3d" | "1w" | "2w" | "custom") => {
    setClosePreset(preset);
    if (preset === "custom") {
      if (!entriesCloseAt) setEntriesCloseAt(toLocalInputValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
      return;
    }
    const days = preset === "24h" ? 1 : preset === "3d" ? 3 : preset === "2w" ? 14 : 7;
    setEntriesCloseAt(toLocalInputValue(new Date(Date.now() + days * 24 * 60 * 60 * 1000)));
  }, [entriesCloseAt, setEntriesCloseAt]);

  const pickReward = useCallback((next: GiveawayDraft["rewardType"]) => {
    if (next === "megapot_ticket") {
      const per = Math.max(1, Math.min(100, Math.round(prizeAmount) || 10));
      updateDraft({ rewardType: next, winnerCount, totalPool: per * winnerCount, prizeToken: null });
      return;
    }
    if (next === "usdc") {
      updateDraft({ rewardType: next, prizeToken: null });
      return;
    }
    updateDraft({ rewardType: next });
  }, [prizeAmount, updateDraft, winnerCount]);

  const bumpWinners = useCallback((dir: 1 | -1) => {
    if (rewardType === "token") {
      updateDraft({ winnerCount: Math.min(MAX_WINNERS, Math.max(1, winnerCount + dir)) });
      return;
    }
    if (rewardType === "megapot_ticket") {
      const next = Math.min(MAX_WINNERS, Math.max(1, winnerCount + dir));
      const per = Math.max(1, Math.min(100, Math.round(prizeAmount) || 1));
      updateDraft({ winnerCount: next, totalPool: per * next });
      return;
    }
    const valid = divisorsUpTo(totalPool, MAX_WINNERS);
    const idx = Math.max(0, valid.indexOf(winnerCount));
    setWinnerCount(valid[Math.min(valid.length - 1, Math.max(0, idx + dir))] ?? valid[0]);
  }, [prizeAmount, rewardType, setWinnerCount, totalPool, updateDraft, winnerCount]);

  const [tokenQuery, setTokenQuery] = useState("");
  const [tokenHits, setTokenHits] = useState<PrizeToken[]>([]);
  const [tokenSearching, setTokenSearching] = useState(false);
  useEffect(() => {
    if (rewardType !== "token") return;
    const q = tokenQuery.trim();
    if (q.length < 2) {
      setTokenHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      setTokenSearching(true);
      fetch(`${BACKEND_URL}/giveaways/public/tokens?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((body: { tokens?: PrizeToken[] }) => setTokenHits(Array.isArray(body.tokens) ? body.tokens : []))
        .catch(() => setTokenHits([]))
        .finally(() => setTokenSearching(false));
    }, 280);
    return () => window.clearTimeout(handle);
  }, [rewardType, tokenQuery]);

  const addTaskOf = useCallback((category: TaskCategory) => {
    updateDraft((prev) => (prev.tasks.length >= MAX_TASKS ? prev : { tasks: [...prev.tasks, newRow(category)] }));
  }, [updateDraft]);

  const platformFee = mode === "create" && createAsAdmin ? 0 : (totalPool > 0 ? Math.max(5, Math.round(totalPool * 10) / 100) : 0);
  const ticketsEach = Math.max(0, Math.round(prizeAmount) || 0);

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
          reward_type: rewardType === "token" ? "usdc" : rewardType,
          prize_mint: rewardType === "token" ? prizeToken?.mint ?? null : null,
          entries_close_at: new Date(entriesCloseAt).toISOString(),
          eligibility: {
            ...(minFollowers ? { min_followers: Number(minFollowers) } : {}),
            ...(minAccountAgeDays ? { min_account_age_days: Number(minAccountAgeDays) } : {}),
            ...(verifiedOnly ? { verified_only: true } : {}),
            ...(requiredCountries.length ? { required_countries: requiredCountries } : {}),
            ...(requiredContinents.length ? { required_continents: requiredContinents } : {}),
            ...(excludedCountries.length ? { excluded_countries: excludedCountries } : {}),
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
      const redirectTo = mode === "edit" && giveawayId ? `/app/rewards/giveaways/${giveawayId}` : "/app/rewards/giveaways/mine";
      setTimeout(() => router.push(redirectTo), 1800);
    } catch (err: any) {
      toast({ variant: "destructive", title: mode === "edit" ? "Failed to save changes" : "Failed to submit giveaway", description: err.message });
    } finally {
      setSubmitting(false);
    }
  }, [mode, giveawayId, notifyEmail, title, description, projectName, logoUrl, totalPool, winnerCount, selectionMode, rewardType, prizeToken, prizeAmount, entriesCloseAt, minFollowers, minAccountAgeDays, verifiedOnly, requiredCountries, requiredContinents, excludedCountries, tasks, createAsAdmin, getAccessToken, router, toast, clearDraft, queryClient]);

  const trySubmit = useCallback(() => {
    if (!title.trim()) {
      toast({ variant: "destructive", title: "Add a title first" });
      return;
    }
    if (rewardType === "token" && !prizeToken?.mint) {
      toast({ variant: "destructive", title: "Choose a token", description: "Search by name, or paste its mint address." });
      return;
    }
    if (!step2Valid) {
      toast({
        variant: "destructive",
        title: rewardType === "megapot_ticket" && prizeAmount > 100
          ? "Ticket prizes are capped at 100 per winner"
          : `Total prize pool must be at least $${effectiveMinPool}`,
      });
      return;
    }
    if (!step3Valid) {
      toast({ variant: "destructive", title: "Every task needs a target, and engage tasks need at least one action" });
      return;
    }
    if (!entriesCloseAt || new Date(entriesCloseAt).getTime() <= Date.now()) {
      toast({ variant: "destructive", title: "Set a close time in the future" });
      return;
    }
    handleSubmit();
  }, [effectiveMinPool, entriesCloseAt, handleSubmit, prizeAmount, prizeToken, rewardType, step2Valid, step3Valid, title, toast]);


  const backHref = mode === "edit" && giveawayId ? `/app/rewards/giveaways/${giveawayId}` : "/app/rewards/giveaways";
  const backLabel = mode === "edit" ? "Back to giveaway" : "Back to giveaways";
  const showForm = authenticated && !(mode === "edit" && (draftLoading || draftError)) && !submitted;
  const isTickets = rewardType === "megapot_ticket";
  const closeWhen = (() => {
    if (!entriesCloseAt) return "—";
    const d = new Date(entriesCloseAt);
    if (isNaN(d.getTime())) return "—";
    return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  })();
  const remain = (() => {
    if (!entriesCloseAt) return "—";
    const diff = new Date(entriesCloseAt).getTime() - Date.now();
    if (isNaN(diff)) return "—";
    if (diff <= 0) return "closed";
    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    return `${days}d ${hours}h`;
  })();
  const closeDatePart = entriesCloseAt?.slice(0, 10) ?? "";
  const closeTimePart = entriesCloseAt && entriesCloseAt.length >= 16 ? entriesCloseAt.slice(11, 16) : "18:00";
  const todayStr = toLocalInputValue(new Date()).slice(0, 10);
  const prizeChips = [
    isTickets ? `${ticketsEach} each` : `${usd(prizeAmount).replace(/\.00$/, "")} each`,
    `${winnerCount} winner${winnerCount === 1 ? "" : "s"}`,
    SELECTION_MODE_LABELS[selectionMode],
  ];
  const ready = Boolean(title.trim()) && step2Valid && step3Valid && Boolean(entriesCloseAt);

  return (
    <>
      <div className={`loofta-app ${sora.variable} ${manrope.variable} ${jetbrainsMono.variable}`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif", color: "#F2EFE8", minHeight: "calc(100vh - var(--header-h, 0px))" }}>
        <div style={{ maxWidth: showForm ? 1180 : 760, margin: "0 auto", padding: "clamp(20px, 4vw, 36px) clamp(16px, 4vw, 28px) 96px", display: "flex", flexDirection: "column", gap: 18 }}>
          <Link href={backHref} style={{ fontWeight: 700, fontSize: 14, color: "#C9C6CF", width: "fit-content" }}>
            ← {backLabel}
          </Link>

          {!authenticated ? (
            <div style={{ ...CARD, alignItems: "center", textAlign: "center", padding: "44px 28px" }}>
              <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 28, letterSpacing: "-0.04em" }}>Sign in to launch a giveaway</span>
              <span style={{ fontSize: 15, color: "#9A98A3", maxWidth: 420 }}>Set the prize, logo, and description. We review it, then you fund the prize.</span>
              <button type="button" onClick={() => login({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false })} style={{ cursor: "pointer", marginTop: 8, padding: "15px 26px", borderRadius: 16, border: 0, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: 600, fontSize: 16 }}>
                Sign in
              </button>
            </div>
          ) : mode === "edit" && draftLoading ? (
            <div style={{ ...CARD, minHeight: 160 }} />
          ) : mode === "edit" && draftError ? (
            <div style={{ ...CARD, alignItems: "center", textAlign: "center" }}>
              <span style={{ color: "#F87171", fontSize: 16 }}>{(draftError as Error).message}</span>
              <Link href={backHref} style={{ fontWeight: 700, color: "#FF7A2A" }}>Back to giveaway</Link>
            </div>
          ) : submitted ? (
            <div style={{ maxWidth: 560, margin: "0 auto", padding: "44px 28px 28px", borderRadius: 30, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
              <div style={{ width: 100, height: 100, borderRadius: 32, transform: "rotate(-6deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.55),0 8px 0 #8E5202,0 28px 56px rgba(245,150,12,0.35)", display: "grid", placeItems: "center", marginBottom: 8 }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6A3500" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m5 12 5 5 9-10" />
                </svg>
              </div>
              <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 30, letterSpacing: "-0.04em" }}>
                {mode === "edit" ? "Changes saved" : "Submitted for approval"}
              </span>
              <span style={{ fontSize: 15, lineHeight: 1.5, color: "#9A98A3", maxWidth: 400 }}>
                {mode === "edit" ? "Taking you back to your giveaway." : "We usually review in about 2 hours. We'll email you when it's approved and ready to fund."}
              </span>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: 24, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
                  <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: "clamp(28px,4vw,36px)", letterSpacing: "-0.05em", lineHeight: 1.05 }}>
                    {mode === "edit" ? "Edit giveaway" : "Launch a giveaway"}
                  </span>
                  <span style={{ fontSize: 15, color: "#9A98A3" }}>Start with the prize, logo, and description. Open the other sections when you need them.</span>
                </div>

                <Fold
                  title="What are you giving?"
                  hint={`${title.trim() || "Add a title"} · ${isTickets ? `${ticketsEach * winnerCount} tickets` : usd(totalPool)} · ${rewardType === "token" ? (prizeToken?.symbol ?? "Any token") : isTickets ? "Lucky Prize" : "USDC"}`}
                  open={prizeOpen}
                  onToggle={() => setPrizeOpen((v) => !v)}
                >
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Giveaway title, e.g. October community drop" style={FIELD} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
                    {([
                      { key: "usdc" as const, label: "USDC", sub: "Cash prize", tile: "radial-gradient(120% 120% at 28% 18%,#9CC8FF 0%,#2775CA 48%,#1A55A0 100%)", rim: "#123E78", ink: "#fff" },
                      { key: "token" as const, label: "Any token", sub: "Search or mint", tile: "#111318", rim: "#2A2A32", ink: "#fff" },
                      { key: "megapot_ticket" as const, label: "Lucky Prize", sub: "$1.1M+ daily", tile: "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)", rim: "#8E5202", ink: "#6A3500" },
                    ]).map((p) => {
                      const on = rewardType === p.key;
                      return (
                        <button key={p.key} type="button" onClick={() => pickReward(p.key)} style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 8px", borderRadius: 18, background: on ? "rgba(255,90,26,0.1)" : "#0E0E12", border: `1.5px solid ${on ? "rgba(255,122,42,0.75)" : "rgba(255,255,255,0.07)"}`, textAlign: "center", color: "#F2EFE8" }}>
                          <span style={{ width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center", overflow: "hidden", fontFamily: SORA, fontWeight: 800, fontSize: 17, color: p.ink, background: p.tile, boxShadow: p.key === "token" ? "none" : `inset 0 2px 4px rgba(255,255,255,0.5),0 3px 0 ${p.rim}` }}>
                            {p.key === "usdc" ? "$" : p.key === "token" ? (
                              <img src="/images/sol.png" alt="" width={28} height={28} style={{ width: 28, height: 28, objectFit: "contain" }} />
                            ) : (
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6A3500" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M3 8.5V6.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 6.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-2a2.5 2.5 0 0 0 0-5z" />
                                <path d="M14 5v12" strokeDasharray="2 2.4" />
                              </svg>
                            )}
                          </span>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{p.label}</span>
                          {p.key === "megapot_ticket" && on ? (
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: "#C9B27A" }}>Megapot</span>
                          ) : (
                            <span style={{ fontSize: 13, color: "#8A8893" }}>{p.sub}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {rewardType === "token" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {prizeToken ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <TokenLogo mint={prizeToken.mint} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontWeight: 700 }}>{prizeToken.symbol}</span>
                            <span style={{ display: "block", fontSize: 12, color: "#8A8893", overflow: "hidden", textOverflow: "ellipsis" }}>{prizeToken.name}</span>
                          </span>
                          <button type="button" onClick={() => updateDraft({ prizeToken: null })} style={{ cursor: "pointer", background: "transparent", border: 0, color: "#C9C6CF", fontWeight: 700 }}>Change</button>
                        </div>
                      ) : (
                        <>
                          <input
                            value={tokenQuery}
                            onChange={(e) => setTokenQuery(e.target.value)}
                            placeholder="Search BONK, JUP… or paste a mint address"
                            style={FIELD}
                          />
                          {tokenSearching && <span style={{ fontSize: 13, color: "#8A8893" }}>Searching…</span>}
                          {tokenHits.map((hit) => (
                            <button
                              key={hit.mint}
                              type="button"
                              onClick={() => { updateDraft({ prizeToken: hit }); setTokenQuery(""); }}
                              style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.08)", color: "#F2EFE8", textAlign: "left" }}
                            >
                              <TokenLogo mint={hit.mint} />
                              <span style={{ fontWeight: 700 }}>{hit.symbol}</span>
                              <span style={{ fontSize: 13, color: "#8A8893" }}>{hit.name}</span>
                            </button>
                          ))}
                          {!tokenSearching && tokenQuery.trim().length >= 32 && tokenHits.length === 0 && (
                            <button
                              type="button"
                              onClick={() => { updateDraft({ prizeToken: { mint: tokenQuery.trim(), symbol: `${tokenQuery.trim().slice(0, 4)}…${tokenQuery.trim().slice(-4)}`, name: "Custom mint", logo: null, decimals: 0, usdPrice: null } }); setTokenQuery(""); }}
                              style={{ cursor: "pointer", padding: "10px 12px", borderRadius: 14, background: "#0E0E12", border: "1px solid rgba(255,122,42,0.45)", color: "#F2EFE8", textAlign: "left", fontWeight: 700 }}
                            >
                              Use this mint address
                            </button>
                          )}
                          {!tokenSearching && tokenQuery.trim().length > 1 && tokenQuery.trim().length < 32 && tokenHits.length === 0 && (
                            <span style={{ fontSize: 13, color: "#8A8893" }}>No token found. Paste its mint address.</span>
                          )}
                        </>
                      )}
                      <span style={{ fontSize: 13, lineHeight: 1.5, color: "#9A98A3" }}>
                        You fund in USDC. The prize pool is swapped into {prizeToken?.symbol ?? "that token"} when the giveaway goes live, and winners are paid in it.
                      </span>
                    </div>
                  )}
                  {isTickets && (
                    <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 16px", borderRadius: 18, background: "linear-gradient(135deg,#2A120C,#120F12)", border: "1px solid rgba(255,90,26,0.28)" }}>
                      <img src="/megapot.svg" alt="Megapot" style={{ height: 24, width: "auto" }} />
                      <span style={{ fontSize: 14, lineHeight: 1.5, color: "#E6C9B8" }}>
                        <span style={{ fontWeight: 800, color: "#fff" }}>Megapot is a daily lottery with a $1.1M+ prize pool.</span>{" "}
                        Each winner gets tickets for the next draw, at $1 per ticket.
                      </span>
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>{isTickets ? "TICKETS PER WINNER" : "TOTAL PRIZE"}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 14px", borderRadius: 14, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.08)" }}>
                        {!isTickets && <span style={{ color: "#5E6880", fontWeight: 700, fontSize: 18 }}>$</span>}
                        <input
                          value={isTickets ? (ticketsEach ? String(ticketsEach) : "") : totalPoolInput}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9.]/g, "").slice(0, 7);
                            if (isTickets) {
                              const n = Math.min(100, parseInt(raw || "0", 10) || 0);
                              updateDraft({ totalPool: n * Math.max(1, winnerCount) });
                            } else {
                              setTotalPoolInput(raw);
                            }
                          }}
                          onBlur={() => {
                            if (isTickets) {
                              const n = Math.max(1, Math.min(100, ticketsEach || 1));
                              updateDraft({ totalPool: n * Math.max(1, winnerCount) });
                            } else {
                              commitTotalPool(Number(totalPoolInput));
                            }
                          }}
                          inputMode="decimal"
                          style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "#F2EFE8", fontFamily: SORA, fontWeight: 700, fontSize: 22, padding: "11px 0" }}
                        />
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>WINNERS</span>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 6, borderRadius: 14, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <button type="button" onClick={() => bumpWinners(-1)} aria-label="Fewer winners" style={{ cursor: "pointer", width: 38, height: 38, borderRadius: 11, background: "#1E1E25", border: 0, color: "#F2EFE8", fontWeight: 800, fontSize: 18 }}>−</button>
                        <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22 }}>{winnerCount}</span>
                        <button type="button" onClick={() => bumpWinners(1)} aria-label="More winners" style={{ cursor: "pointer", width: 38, height: 38, borderRadius: 11, background: "#1E1E25", border: 0, color: "#F2EFE8", fontWeight: 800, fontSize: 18 }}>+</button>
                      </div>
                    </div>
                  </div>
                  <span style={{ fontSize: 14, color: "#8A8893" }}>
                    {isTickets
                      ? `${winnerCount} winners × ${ticketsEach} tickets = ${ticketsEach * winnerCount} tickets (${usd(ticketsEach * winnerCount)})`
                      : rewardType === "token"
                        ? `Each winner gets ${usd(prizeAmount)} in ${prizeToken?.symbol ?? "the token"}${prizeToken?.usdPrice ? ` (about ${(prizeAmount / prizeToken.usdPrice).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${prizeToken.symbol})` : ""}`
                        : `Each winner gets ${usd(prizeAmount)} USDC`}
                  </span>
                  {rewardType === "megapot_ticket" && prizeAmount > 100 && (
                    <span style={{ fontSize: 14, color: "#F87171" }}>Ticket prizes are capped at 100 per winner.</span>
                  )}
                  {!isTickets && totalPool < effectiveMinPool && (
                    <span style={{ fontSize: 14, color: "#F87171" }}>Prize pool must be at least ${effectiveMinPool}.</span>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>DESCRIPTION</span>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What's this giveaway for?" style={{ ...FIELD, fontWeight: 500, resize: "vertical", fontFamily: "inherit" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>PROJECT NAME</span>
                      <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Your project or brand" style={{ ...FIELD, fontWeight: 500 }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>LOGO</span>
                      <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, border: "1.5px dashed rgba(255,255,255,0.14)", fontSize: 14, fontWeight: 600, color: "#B5B2BC" }}>
                        {logoUrl ? <Image src={logoUrl} alt="" width={28} height={28} style={{ width: 28, height: 28, borderRadius: 8, objectFit: "cover" }} /> : null}
                        {uploadingLogo ? "Uploading…" : logoUrl ? "Change square logo" : "+ Upload square logo"}
                        <input type="file" accept="image/*" hidden disabled={uploadingLogo} onChange={(e) => { const file = e.target.files?.[0]; if (file) setPendingLogoFile(file); e.target.value = ""; }} />
                      </label>
                    </div>
                  </div>
                </Fold>

                <Fold
                  title="How do people enter?"
                  hint={`${tasks.length} task${tasks.length === 1 ? "" : "s"} · ${previewTasks[0]?.label ?? "Add a task"}`}
                  open={tasksOpen}
                  onToggle={() => setTasksOpen((v) => !v)}
                >
                  {tasks.map((task) => (
                    <div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 8px 8px 10px", borderRadius: 16, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <span style={{ flex: "none", width: 36, height: 36, borderRadius: 11, background: taskTile(task.category), display: "grid", placeItems: "center" }}>
                        <TaskGlyph category={task.category} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#8A8893" }}>{CATEGORY_LABELS[task.category]}</span>
                        {task.category === "custom" ? (
                          <>
                            <input value={task.title} onChange={(e) => setTaskTitle(task.id, e.target.value)} placeholder="Task title — e.g. Join the stream" style={{ background: "transparent", border: 0, outline: "none", color: "#F2EFE8", fontSize: 15, fontWeight: 600, padding: "2px 0" }} />
                            <input value={task.target} onChange={(e) => setTaskTarget(task.id, e.target.value)} placeholder="Link (optional)" style={{ background: "transparent", border: 0, outline: "none", color: "#C9C6CF", fontSize: 14, padding: "2px 0" }} />
                          </>
                        ) : task.category === "x_post" ? (
                          <RequiredTextField value={task.requiredText ?? ""} onChange={(v) => setTaskRequiredText(task.id, v)} />
                        ) : (
                          <input value={task.target} onChange={(e) => setTaskTarget(task.id, e.target.value)} placeholder={CATEGORY_TARGET_LABELS[task.category]} style={{ background: "transparent", border: 0, outline: "none", color: "#F2EFE8", fontSize: 15, fontWeight: 600, padding: "2px 0" }} />
                        )}
                        {task.category === "engage" && (
                          <>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 8 }}>
                              {ENGAGE_ACTIONS.map((action) => {
                                const on = task.engage[action.key];
                                return (
                                  <button key={action.key} type="button" onClick={() => toggleEngageAction(task.id, action.key)} style={{ cursor: "pointer", padding: "7px 12px", borderRadius: 999, fontWeight: 700, fontSize: 13, background: on ? "rgba(255,90,26,0.12)" : "#17171D", color: on ? "#F2EFE8" : "#9A98A3", border: `1px solid ${on ? "rgba(255,122,42,0.7)" : "rgba(255,255,255,0.08)"}` }}>
                                    {on ? "✓" : "+"} {action.label}
                                  </button>
                                );
                              })}
                            </div>
                            <input value={task.instructions} onChange={(e) => setTaskInstructions(task.id, e.target.value)} placeholder="Instructions — e.g. quote this post and mention the launch" style={{ marginTop: 8, background: "#17171D", border: "1px solid rgba(255,255,255,0.08)", outline: "none", color: "#F2EFE8", fontSize: 14, borderRadius: 10, padding: "8px 10px" }} />
                          </>
                        )}
                        {SELF_REPORT_CATEGORIES.has(task.category) && (
                          <button type="button" onClick={() => toggleRequireProof(task.id)} style={{ cursor: "pointer", marginTop: 8, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: "#17171D", border: `1px solid ${task.requireProof ? "rgba(255,122,42,0.7)" : "rgba(255,255,255,0.08)"}`, textAlign: "left", width: "100%" }}>
                            <span style={{ flex: 1 }}>
                              <span style={{ display: "block", fontWeight: 700, fontSize: 13.5, color: "#F2EFE8" }}>Require proof of completion</span>
                              <span style={{ display: "block", fontSize: 12, color: "#8A8893" }}>Ask entrants to submit a screenshot or a link</span>
                            </span>
                            <Toggle on={task.requireProof} />
                          </button>
                        )}
                      </div>
                      {tasks.length > 1 && (
                        <button type="button" onClick={() => removeTask(task.id)} aria-label="Remove task" className="lh-19" style={{ cursor: "pointer", flex: "none", width: 32, height: 32, borderRadius: 10, border: 0, background: "transparent", color: "#6E6C78", fontSize: 18 }}>×</button>
                      )}
                    </div>
                  ))}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", color: "#6E6C78" }}>ADD A TASK</span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {ADD_TASKS.map((ta) => (
                        <button key={ta.category} type="button" onClick={() => addTaskOf(ta.category)} disabled={tasks.length >= MAX_TASKS} className="lh-20" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 7, padding: "8px 13px 8px 8px", borderRadius: 999, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.08)", fontWeight: 700, fontSize: 14, color: "#C9C6CF", opacity: tasks.length >= MAX_TASKS ? 0.4 : 1 }}>
                          <span style={{ width: 22, height: 22, borderRadius: 7, background: taskTile(ta.category), display: "grid", placeItems: "center" }}>
                            <TaskGlyph category={ta.category} size={12} />
                          </span>
                          + {ta.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, color: "#77757F" }}>X tasks are checked automatically. Fewer tasks means more entries.</span>
                </Fold>

                <Fold
                  title="When does it close?"
                  hint={closeWhen}
                  open={closeOpen}
                  onToggle={() => setCloseOpen((v) => !v)}
                >
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {([
                      ["24h", "24 hours"],
                      ["3d", "3 days"],
                      ["1w", "1 week"],
                      ["2w", "2 weeks"],
                      ["custom", "Pick a date"],
                    ] as const).map(([key, label]) => {
                      const on = closePreset === key;
                      return (
                        <button key={key} type="button" onClick={() => applyClosePreset(key)} style={{ cursor: "pointer", padding: "10px 15px", borderRadius: 999, fontWeight: 700, fontSize: 14, background: on ? "rgba(255,90,26,0.12)" : "#0E0E12", color: on ? "#F2EFE8" : "#9A98A3", border: `1px solid ${on ? "rgba(255,122,42,0.7)" : "rgba(255,255,255,0.08)"}` }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {closePreset === "custom" && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", color: "#8A8893" }}>DATE</span>
                        <input type="date" value={closeDatePart} min={todayStr} onChange={(e) => setEntriesCloseAt(`${e.target.value}T${closeTimePart || "18:00"}`)} style={{ ...FIELD, colorScheme: "dark" }} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", color: "#8A8893" }}>TIME</span>
                        <input type="time" value={closeTimePart} onChange={(e) => setEntriesCloseAt(`${closeDatePart || todayStr}T${e.target.value}`)} style={{ ...FIELD, colorScheme: "dark" }} />
                      </div>
                    </div>
                  )}
                  <span style={{ fontSize: 13, color: "#8A8893" }}>
                    Entries close <span style={{ color: "#F2EFE8", fontWeight: 700 }}>{closeWhen}</span> · one week is the sweet spot
                  </span>
                </Fold>

                <Fold
                  title="Who can enter"
                  hint={`${SELECTION_MODE_LABELS[selectionMode]}${minFollowers ? ` · ${minFollowers}+ followers` : ""}${verifiedOnly ? " · verified only" : ""}`}
                  open={moreOpen}
                  onToggle={() => setMoreOpen((v) => !v)}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {isAdmin && mode === "create" && (
                        <button type="button" onClick={() => setCreateAsAdmin((v) => !v)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 16, background: createAsAdmin ? "rgba(255,122,42,0.1)" : "#0E0E12", border: `1px solid ${createAsAdmin ? "rgba(255,122,42,0.4)" : "rgba(255,255,255,0.08)"}`, color: "#F2EFE8", textAlign: "left" }}>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: "block", fontWeight: 700, fontSize: 15 }}>Create as Loofta</span>
                            <span style={{ display: "block", fontSize: 13, color: "#8A8893" }}>Admin only. Auto-approved, and the prize pool can be as low as ${ADMIN_MIN_TOTAL_POOL}.</span>
                          </span>
                          <Toggle on={createAsAdmin} />
                        </button>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>WINNER SELECTION</span>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {(["random", "first_come", "manual"] as const).map((modeKey) => {
                            const on = selectionMode === modeKey;
                            return (
                              <button key={modeKey} type="button" onClick={() => setSelectionMode(modeKey)} style={{ cursor: "pointer", padding: "10px 15px", borderRadius: 999, fontWeight: 700, fontSize: 14, background: on ? "rgba(255,90,26,0.12)" : "#0E0E12", color: on ? "#F2EFE8" : "#9A98A3", border: `1px solid ${on ? "rgba(255,122,42,0.7)" : "rgba(255,255,255,0.08)"}` }}>
                                {SELECTION_MODE_LABELS[modeKey]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>MIN X FOLLOWERS</span>
                          <input value={minFollowers} onChange={(e) => setMinFollowers(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 100" inputMode="numeric" style={{ ...FIELD, fontWeight: 500, border: `1px solid ${minFollowers && !["10", "100", "1000"].includes(minFollowers) ? "rgba(255,122,42,0.6)" : "rgba(255,255,255,0.08)"}` }} />
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {([["10", "10"], ["100", "100"], ["1000", "1,000"]] as const).map(([value, label]) => {
                              const on = minFollowers === value;
                              return (
                                <button key={value} type="button" onClick={() => setMinFollowers(value)} style={{ cursor: "pointer", padding: "9px 14px", borderRadius: 999, fontWeight: 700, fontSize: 13.5, background: on ? "rgba(255,90,26,0.12)" : "#0E0E12", color: on ? "#F2EFE8" : "#9A98A3", border: `1px solid ${on ? "rgba(255,122,42,0.7)" : "rgba(255,255,255,0.08)"}` }}>
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>MIN X ACCOUNT AGE (DAYS)</span>
                          <input value={minAccountAgeDays} onChange={(e) => setMinAccountAgeDays(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 30" inputMode="numeric" style={{ ...FIELD, fontWeight: 500 }} />
                        </div>
                      </div>
                      <button type="button" onClick={() => setVerifiedOnly(!verifiedOnly)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 16, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.08)", color: "#F2EFE8", textAlign: "left" }}>
                        <span style={{ flex: 1 }}>
                          <span style={{ display: "block", fontWeight: 700, fontSize: 15 }}>Verified X accounts only</span>
                          <span style={{ display: "block", fontSize: 13, color: "#8A8893" }}>Only entrants with X&apos;s verified badge</span>
                        </span>
                        <Toggle on={verifiedOnly} />
                      </button>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>CONTINENTS</span>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {CONTINENTS.map((continent) => {
                            const on = requiredContinents.includes(continent);
                            return (
                              <button key={continent} type="button" onClick={() => toggleContinent(continent)} style={{ cursor: "pointer", padding: "8px 12px", borderRadius: 999, fontWeight: 700, fontSize: 13, background: on ? "rgba(255,90,26,0.12)" : "#0E0E12", color: on ? "#F2EFE8" : "#9A98A3", border: `1px solid ${on ? "rgba(255,122,42,0.7)" : "rgba(255,255,255,0.08)"}` }}>
                                {continent}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>COUNTRIES</span>
                        <CountryMultiSelect selected={requiredCountries} onAdd={addRequiredCountry} onRemove={removeRequiredCountry} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3", letterSpacing: "0.04em" }}>EXCLUDE COUNTRIES</span>
                        <CountryMultiSelect selected={excludedCountries} onAdd={addExcludedCountry} onRemove={removeExcludedCountry} />
                      </div>
                  </div>
                </Fold>

                <div style={CARD}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
                      <span style={{ color: "#B5B2BC" }}>Prize</span>
                      <span style={{ fontWeight: 700 }}>{isTickets ? `${ticketsEach * winnerCount} tickets · ${usd(totalPool)}` : usd(totalPool)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
                      <span style={{ color: "#B5B2BC" }}>Platform fee (10%, $5 min)</span>
                      <span style={{ fontWeight: 700 }}>{usd(platformFee)}</span>
                    </div>
                    <div style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontWeight: 700 }}>{mode === "edit" ? "Funding total" : "You'll fund after approval"}</span>
                      <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 24, letterSpacing: "-0.03em" }}>{usd(totalPool + platformFee)}</span>
                    </div>
                  </div>
                  {notifyEmail ? (
                    <div style={{ ...FIELD, fontWeight: 500, color: "#C9C6CF" }}>We&apos;ll email {notifyEmail}</div>
                  ) : (
                    <button type="button" onClick={() => linkEmail()} style={{ ...FIELD, cursor: "pointer", textAlign: "left", fontWeight: 600, color: "#F2EFE8", background: "#0E0E12" }}>
                      Add your email for approval and payout updates
                    </button>
                  )}
                  <button type="button" onClick={trySubmit} disabled={submitting || (mode === "create" && !notifyEmail)} style={{ cursor: "pointer", textAlign: "center", padding: 18, borderRadius: 18, border: 0, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: 600, fontSize: 17, opacity: ready && (mode !== "create" || notifyEmail) ? 1 : 0.45, boxShadow: "0 14px 40px rgba(255,70,10,0.3)" }}>
                    {submitting ? (mode === "edit" ? "Saving…" : "Submitting…") : mode === "edit" ? "Save changes" : "Submit for approval"}
                  </button>
                  <span style={{ fontSize: 13, lineHeight: 1.5, color: "#6E6C78", textAlign: "center" }}>
                    Loofta reviews every giveaway before it opens. After approval, changes to the prize or tasks go through support.
                  </span>
                </div>
              </div>

              <div style={{ position: "sticky", top: 90, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                <span style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.18em", color: "#5FD38E" }}>LIVE PREVIEW</span>
                <div style={{ padding: 22, borderRadius: 28, background: "#141419", border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 30px 80px rgba(0,0,0,0.4)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#8A8893", display: "flex", alignItems: "center", gap: 8 }}>
                      {logoUrl ? <Image src={logoUrl} alt="" width={18} height={18} style={{ width: 18, height: 18, borderRadius: 99, objectFit: "cover" }} /> : null}
                      {projectName.trim() || "Your project"}
                    </span>
                    <span style={{ padding: "4px 11px", borderRadius: 999, background: "#22222A", fontSize: 13, fontWeight: 800 }}>Draft</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em" }}>{title.trim() || "Your giveaway title"}</span>
                    {description.trim() ? <span style={{ fontSize: 14, color: "#9A98A3" }}>{description}</span> : null}
                  </div>
                  <div style={{ padding: 20, borderRadius: 22, background: isTickets ? "linear-gradient(150deg,#2E1E06,#15120E)" : "linear-gradient(150deg,#0F2016,#101513)", border: `1px solid ${isTickets ? "rgba(245,183,12,0.35)" : "rgba(60,200,120,0.3)"}`, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.16em", color: isTickets ? "#F5B70C" : "#5FD38E" }}>PRIZE POOL · IN ESCROW</span>
                      <span style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: 800, fontSize: 14, color: isTickets ? "#6A3500" : "#fff", background: isTickets ? "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)" : "#2775CA" }}>
                        {isTickets ? "M" : "$"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 44, letterSpacing: "-0.05em", lineHeight: 1 }}>
                        {isTickets ? String(ticketsEach * winnerCount) : usd(totalPool).replace(/\.00$/, "")}
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "#B5B2BC" }}>{isTickets ? "tickets" : "USDC"}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {prizeChips.map((pc) => (
                        <span key={pc} style={{ padding: "6px 11px", borderRadius: 999, background: "rgba(255,255,255,0.08)", fontSize: 13, fontWeight: 700 }}>{pc}</span>
                      ))}
                    </div>
                    <span style={{ fontSize: 13, color: "#9A98A3" }}>
                      Closes in <span style={{ color: "#F2EFE8", fontWeight: 700 }}>{remain}</span>
                    </span>
                  </div>
                  {isTickets && (
                    <span style={{ fontSize: 13, color: "#9A98A3", lineHeight: 1.5 }}>
                      Tickets for Megapot&apos;s daily draw. Today&apos;s jackpot: <span style={{ color: "#F5B70C", fontWeight: 800 }}>$1.1M+</span>
                    </span>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.16em", color: "#77757F" }}>TO ENTER</span>
                    {previewTasks.length === 0 ? (
                      <span style={{ fontSize: 14, color: "#8A8893" }}>Add a task and it shows up here.</span>
                    ) : previewTasks.map((pt) => (
                      <div key={pt.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 16, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <span style={{ flex: "none", width: 30, height: 30, borderRadius: 10, background: taskTile(pt.category), display: "grid", placeItems: "center" }}>
                          <TaskGlyph category={pt.category} size={13} />
                        </span>
                        <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{pt.label}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#8A8893" }}>To do</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ width: "100%", textAlign: "center", padding: 14, borderRadius: 16, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontWeight: 700, fontSize: 15, opacity: 0.9 }}>
                    Enter giveaway
                  </div>
                </div>
                <div style={{ padding: "16px 18px", borderRadius: 20, background: "#101014", border: "1px solid rgba(255,255,255,0.06)", fontSize: 14, lineHeight: 1.5, color: "#9A98A3" }}>
                  Want this on your own domain, with your logo and no Loofta branding?{" "}
                  <a href="https://t.me/looftaxyz" style={{ fontWeight: 700, color: "#F2EFE8" }}>Message us on Telegram</a>
                </div>
              </div>
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
    </>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span style={{ position: "relative", flex: "none", width: 52, height: 30, borderRadius: 999, background: on ? "linear-gradient(90deg,#FF2D0A,#F5B70C)" : "#3A3A44" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 25 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
    </span>
  );
}
