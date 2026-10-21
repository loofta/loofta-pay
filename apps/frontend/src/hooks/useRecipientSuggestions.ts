"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth";

export type RecipientSuggestion =
  | { kind: "social"; platform: "twitter" | "discord" | "github" | "telegram" | "loofta"; value: string }
  | { kind: "email"; value: string }
  | { kind: "cash"; platform: string; value: string };

type HistoryRow = {
  created_at: string;
  recipient_username?: string | null;
  recipient_email?: string | null;
  recipient_address?: string;
  creator_username?: string | null;
  sender_username?: string | null;
  recipient_socials?: { platform: string; handle: string }[];
};

const SOCIAL = new Set(["twitter", "discord", "github", "telegram", "loofta"]);
const CASH = new Set(["venmo", "cashapp", "revolut", "xmoney"]);

// History loses the typed handle once the recipient has a Loofta account (only their Loofta
// username is stored), so sends are also remembered locally with the platform that was typed.
const LOCAL_KEY = "loofta.recentRecipients.v1";
const LOCAL_MAX = 50;
type LocalEntry = { s: RecipientSuggestion; at: number };

function readLocal(): LocalEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function rememberRecipient(s: RecipientSuggestion) {
  try {
    const key = (x: RecipientSuggestion) => `${x.kind}:${"platform" in x ? x.platform : ""}:${x.value.toLowerCase()}`;
    const rest = readLocal().filter((e) => key(e.s) !== key(s));
    localStorage.setItem(LOCAL_KEY, JSON.stringify([{ s, at: Date.now() }, ...rest].slice(0, LOCAL_MAX)));
  } catch { /* storage unavailable, suggestions just rely on history */ }
}

function fromSentRow(row: HistoryRow): RecipientSuggestion | null {
  const ra = row.recipient_address || "";
  if (ra.startsWith("PENDING_SOCIAL:")) {
    const rest = ra.slice("PENDING_SOCIAL:".length);
    const sep = rest.indexOf(":");
    const platform = sep >= 0 ? rest.slice(0, sep) : "";
    const value = (sep >= 0 ? rest.slice(sep + 1) : "").replace(/^[@$]/, "");
    if (!value) return null;
    if (CASH.has(platform)) return { kind: "cash", platform, value };
    if (SOCIAL.has(platform)) return { kind: "social", platform: platform as "twitter", value };
    return null;
  }
  if (ra.startsWith("PENDING_EMAIL:")) {
    const value = ra.slice("PENDING_EMAIL:".length);
    return value ? { kind: "email", value } : null;
  }
  // Unregistered handle sent through the plain username field resolves as an X handle.
  if (ra.startsWith("PENDING_USERNAME:")) {
    const value = ra.slice("PENDING_USERNAME:".length);
    return value ? { kind: "social", platform: "twitter", value } : null;
  }
  if (row.recipient_username) return { kind: "social", platform: "loofta", value: row.recipient_username };
  if (row.recipient_email) return { kind: "email", value: row.recipient_email };
  return null;
}

/** Connected handles of a registered recipient (X, Telegram, ...), as separate suggestions. */
function socialsFromSentRow(row: HistoryRow): RecipientSuggestion[] {
  return (row.recipient_socials ?? [])
    .filter((x) => SOCIAL.has(x.platform) && x.handle)
    .map((x) => ({ kind: "social" as const, platform: x.platform as "twitter", value: x.handle }));
}

function fromReceivedRow(row: HistoryRow): RecipientSuggestion | null {
  const name = row.sender_username || row.creator_username;
  return name ? { kind: "social", platform: "loofta", value: name } : null;
}

/**
 * People the signed-in user has sent to (every platform) or received from (Loofta usernames),
 * most recent first and de-duplicated. Reads the same history endpoint the app home uses, so no
 * backend change is needed. Empty when signed out.
 */
export function useRecipientSuggestions(): RecipientSuggestion[] {
  const { authenticated, userId, getAccessToken } = useAuth();
  const networkMode = useAuthStore((s) => s.networkMode);

  const history = useQuery({
    queryKey: ["recipient-suggestions", userId, networkMode],
    enabled: authenticated && !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
      const params = new URLSearchParams({ limit: "200" });
      if (networkMode) params.set("network", networkMode);
      const r = await fetch(`/api/payments/history?${params}`, { headers, cache: "no-store" });
      if (!r.ok) throw new Error("history");
      return (await r.json()) as { sent?: HistoryRow[]; received?: HistoryRow[] };
    },
  });

  return useMemo(() => {
    const rows: { at: number; s: RecipientSuggestion }[] = [];
    for (const row of history.data?.sent ?? []) {
      const at = Date.parse(row.created_at) || 0;
      for (const s of socialsFromSentRow(row)) rows.push({ at, s });
      const s = fromSentRow(row);
      if (s) rows.push({ at: at - 1, s });
    }
    for (const row of history.data?.received ?? []) {
      const s = fromReceivedRow(row);
      if (s) rows.push({ at: Date.parse(row.created_at) || 0, s });
    }
    for (const e of readLocal()) rows.push({ at: e.at, s: e.s });
    rows.sort((a, b) => b.at - a.at);
    const seen = new Set<string>();
    const out: RecipientSuggestion[] = [];
    for (const { s } of rows) {
      const key = `${s.kind}:${"platform" in s ? s.platform : ""}:${s.value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  }, [history.data]);
}

/** Narrow suggestions to the current destination mode and typed text. */
export function filterSuggestions(
  all: RecipientSuggestion[],
  mode: { kind: "social" } | { kind: "email" } | { kind: "cash"; platform: string },
  query: string,
  limit = 5,
): RecipientSuggestion[] {
  const q = query.trim().replace(/^[@$]+/, "").toLowerCase();
  return all
    .filter((s) => {
      if (s.kind !== mode.kind) return false;
      if (s.kind === "cash" && mode.kind === "cash" && s.platform !== mode.platform) return false;
      const v = s.value.toLowerCase();
      return q ? v.includes(q) && v !== q : true;
    })
    .slice(0, limit);
}

/** Arrow/Enter/Escape navigation for the suggestion list. onKeyDown returns true when it handled the key. */
export function useSuggestionNav(items: RecipientSuggestion[], onPick: (s: RecipientSuggestion) => void) {
  const [active, setActive] = useState(-1);
  const sig = items.map((s) => `${"platform" in s ? s.platform : ""}:${s.value}`).join("|");
  useEffect(() => setActive(-1), [sig]);

  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (items.length === 0) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
      return true;
    }
    if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      onPick(items[active]);
      return true;
    }
    return false;
  };
  return { active, onKeyDown };
}
