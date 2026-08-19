import type { QueryClient } from "@tanstack/react-query";

/**
 * A recipient edit on /app/c/[id] must refresh both the claim detail query AND the
 * ["payments","history"] list query (apps/frontend/src/app/app/history/page.tsx) — the list
 * renders recipient_username/recipient_email/recipient_address from its own cached fetch, so
 * without this second invalidation it kept showing the old recipient after a successful edit.
 */
export function invalidateAfterRecipientUpdate(queryClient: QueryClient, claimId: string, userId?: string) {
  queryClient.invalidateQueries({ queryKey: ["claim", claimId, userId] });
  queryClient.invalidateQueries({ queryKey: ["payments", "history"] });
}
