"use client";

import { use, useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/ui/use-toast";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Input } from "@/components/ui/input";
import { ReviewQueueItem, ReviewQueueItemData } from "@/components/giveaways/ReviewQueueItem";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const PAGE_SIZE = 10;

// No Privy anywhere on this page, deliberately — it's reached via a password-protected link
// shared with someone who may not have (or need) a Loofta account at all. Auth is just the
// session token this page gets back from /auth and holds in memory + sessionStorage.
export default function GiveawayReviewLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [giveawayTitle, setGiveawayTitle] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const storageKey = `giveaway-review-session:${token}`;

  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { sessionToken: string; giveawayTitle: string };
        setSessionToken(parsed.sessionToken);
        setGiveawayTitle(parsed.giveawayTitle);
      } catch {
        sessionStorage.removeItem(storageKey);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const authenticate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthenticating(true);
    setAuthError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/review-link/${token}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message || "Incorrect password");
      setSessionToken(body.sessionToken);
      setGiveawayTitle(body.giveawayTitle);
      sessionStorage.setItem(storageKey, JSON.stringify({ sessionToken: body.sessionToken, giveawayTitle: body.giveawayTitle }));
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthenticating(false);
    }
  }, [token, password, storageKey]);

  const { data: queue, refetch } = useQuery({
    queryKey: ["giveaway-review-link-queue", token, page],
    enabled: !!sessionToken,
    queryFn: async (): Promise<{ items: ReviewQueueItemData[]; total: number }> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/review-link/${token}/queue?page=${page}&pageSize=${PAGE_SIZE}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (res.status === 401 || res.status === 403) {
        sessionStorage.removeItem(storageKey);
        setSessionToken(null);
        throw new Error("Session expired — please re-enter the password");
      }
      if (!res.ok) throw new Error("Failed to load review queue");
      const body = await res.json();
      return { items: body.items ?? [], total: body.total ?? 0 };
    },
  });

  const review = useCallback(async (completionId: string, decision: "verified" | "rejected") => {
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/review-link/${token}/completions/${completionId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: `Marked ${decision}` });
      refetch();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to review", description: err.message });
    }
  }, [token, sessionToken, toast, refetch]);

  const totalPages = Math.max(1, Math.ceil((queue?.total ?? 0) / PAGE_SIZE));

  if (!sessionToken) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white flex items-center justify-center px-4">
        <form onSubmit={authenticate} className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
          <div className="flex items-center gap-2 text-slate-300">
            <Lock className="w-4 h-4" />
            <p className="text-base font-medium uppercase tracking-widest">Task review</p>
          </div>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="bg-white/[0.06] border-white/15 text-white placeholder:text-slate-500"
          />
          {authError && <p className="text-base text-red-400">{authError}</p>}
          <GradientActionButton type="submit" disabled={authenticating || !password}>
            {authenticating ? "Checking…" : "Continue"}
          </GradientActionButton>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24 space-y-4">
        <div>
          <p className="text-base font-medium text-slate-400 uppercase tracking-widest">Task review</p>
          {giveawayTitle && <h1 className="text-2xl font-medium text-white mt-1">{giveawayTitle}</h1>}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-base font-medium text-slate-400 uppercase tracking-widest mb-2">
            Awaiting review {queue ? `(${queue.total})` : ""}
          </p>
          <div className="space-y-2">
            {(queue?.items ?? []).map((item) => (
              <ReviewQueueItem
                key={item.id}
                item={item}
                onApprove={(id) => review(id, "verified")}
                onReject={(id) => review(id, "rejected")}
              />
            ))}
            {queue && queue.items.length === 0 && <p className="text-base text-slate-500">Nothing to review right now</p>}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 mt-1 border-t border-white/10">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-base text-slate-400">Page {page} of {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
