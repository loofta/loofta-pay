"use client";

import { Mail } from "lucide-react";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { DIRECT_CASH_PLATFORMS } from "@/lib/peerPlatforms";
import type { RecipientSuggestion } from "@/hooks/useRecipientSuggestions";

const PLATFORM_NAMES: Record<string, string> = {
  twitter: "Twitter",
  discord: "Discord",
  github: "GitHub",
  telegram: "Telegram",
  loofta: "Loofta",
};

/** Dropdown of past recipients under a recipient input. Picking one fills the platform too. */
export function RecipientSuggestionList({
  items,
  active = -1,
  onPick,
}: {
  items: RecipientSuggestion[];
  active?: number;
  onPick: (s: RecipientSuggestion) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul
      role="listbox"
      className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-2xl border border-white/10 bg-[#17171E] p-1 shadow-xl"
    >
      {items.map((s, i) => {
        const cash = s.kind === "cash" ? DIRECT_CASH_PLATFORMS.find((p) => p.id === s.platform) : null;
        const label =
          s.kind === "social"
            ? `@${s.value} on ${PLATFORM_NAMES[s.platform]}`
            : s.kind === "cash"
              ? `@${s.value} on ${cash?.name ?? s.platform}`
              : s.value;
        return (
          <li key={`${s.kind}:${"platform" in s ? s.platform : ""}:${s.value}`}>
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              // mousedown fires before the input's blur, so the pick lands before the list closes
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(s);
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-base font-medium transition-colors hover:bg-white/[0.07] hover:text-white ${i === active ? "bg-white/[0.1] text-white" : "text-slate-200"}`}
            >
              {s.kind === "social" ? (
                <SocialPlatformIcon platform={s.platform} className="h-4 w-4 shrink-0" />
              ) : s.kind === "cash" ? (
                <img src={cash?.logo} alt="" className="h-4 w-4 shrink-0 rounded object-cover" />
              ) : (
                <Mail className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
