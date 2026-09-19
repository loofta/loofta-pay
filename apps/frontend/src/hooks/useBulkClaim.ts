"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import type { UnclaimedPayment } from "@/hooks/useUnclaimedPaymentToast";

export type BulkClaimStatus = "pending" | "claiming" | "success" | "failed";

/**
 * Claims several already-funded payments one after another by driving the same
 * POST /claims/:id/claim endpoint the single-claim page uses (see
 * claimAsRecipientMutation in app/app/c/[id]/page.tsx) — no new backend surface,
 * same auth pattern, same "already claimed" -> treat-as-success fallback, same
 * background claim-retry-sweep call after a successful sweep.
 *
 * Sequential on purpose: claims:claim is rate-limited to 5/60s per user, and each
 * call can legitimately block for tens of seconds while the sweep waits for the
 * burner to be funded, so firing them in parallel would just trade one slow claim
 * for several slow claims competing for the same window.
 */
export function useBulkClaim() {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState<Map<string, BulkClaimStatus>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const runIdRef = useRef(0);

  const invalidatePaymentQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["payments", "unclaimed-nudge"] });
    queryClient.invalidateQueries({ queryKey: ["payments", "history"] });
  }, [queryClient]);

  const claimOne = useCallback(
    async (payment: UnclaimedPayment): Promise<boolean> => {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const token = await getAccessToken().catch(() => null);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const resp = await fetch(`${backendUrl}/claims/${payment.id}/claim`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });

      if (resp.ok) {
        // Fire-and-forget, mirrors claimAsRecipientMutation — never block the loop on this.
        fetch(`${backendUrl}/claims/${payment.id}/claim-retry-sweep`, { method: "POST", headers }).catch(() => {});
        return true;
      }

      const err = await resp.json().catch(() => ({}) as { message?: string });
      const msg = String(err?.message || "");
      if (/not pending claim|already been claimed|already claimed/i.test(msg)) {
        fetch(`${backendUrl}/claims/${payment.id}/claim-retry-sweep`, { method: "POST", headers }).catch(() => {});
        return true;
      }
      if (resp.status === 429) {
        const retryAfterHeader = resp.headers.get("Retry-After");
        const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 60_000;
        await new Promise((r) => setTimeout(r, Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 60_000));
        return claimOne(payment);
      }
      return false;
    },
    [getAccessToken],
  );

  const start = useCallback(
    async (payments: UnclaimedPayment[]) => {
      const runId = ++runIdRef.current;
      setIsRunning(true);
      setStatuses(new Map(payments.map((p) => [p.id, "pending" as BulkClaimStatus])));

      for (const payment of payments) {
        if (runIdRef.current !== runId) return; // a newer run superseded this one
        setStatuses((prev) => new Map(prev).set(payment.id, "claiming"));
        let ok = false;
        try {
          ok = await claimOne(payment);
        } catch {
          ok = false;
        }
        if (runIdRef.current !== runId) return;
        setStatuses((prev) => new Map(prev).set(payment.id, ok ? "success" : "failed"));
        invalidatePaymentQueries();
      }

      if (runIdRef.current === runId) setIsRunning(false);
    },
    [claimOne, invalidatePaymentQueries],
  );

  return { start, statuses, isRunning };
}
