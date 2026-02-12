"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { dealsApi, type DealCommentResponse } from "@/services/api/deals";
import { MessageSquare, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";

export type DealCommentsProps = {
  orgId: string;
  dealId: string;
  onCommentAdded?: () => void;
  className?: string;
};

export function DealComments({ orgId, dealId, onCommentAdded, className }: DealCommentsProps) {
  const { userId } = useAuth();
  const { toast } = useToast();
  const [comments, setComments] = useState<DealCommentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBody, setNewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadComments = useCallback(() => {
    if (!orgId || !dealId) return;
    setLoading(true);
    dealsApi.deals
      .listComments(orgId, dealId, userId ?? undefined)
      .then(setComments)
      .catch(() => {
        toast({ variant: "destructive", title: "Failed to load comments" });
        setComments([]);
      })
      .finally(() => setLoading(false));
  }, [orgId, dealId, userId, toast]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = newBody.trim();
    if (!body || !userId) return;
    setSubmitting(true);
    dealsApi.deals
      .addComment(orgId, dealId, body, userId)
      .then((created) => {
        setComments((prev) => [...prev, created]);
        setNewBody("");
        onCommentAdded?.();
        toast({ title: "Comment added" });
      })
      .catch(() => {
        toast({ variant: "destructive", title: "Failed to add comment" });
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-medium text-gray-900">Comments</h3>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {comments.length === 0 ? (
              <li className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 py-4 text-center text-sm text-gray-500">
                No comments yet. Add one below.
              </li>
            ) : (
              comments.map((c) => (
                <li key={c.id} className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-gray-700">
                      {userId && c.author_user_id === userId ? "You" : c.author_display}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(c.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{c.body}</p>
                </li>
              ))
            )}
          </ul>

          {userId ? (
            <form onSubmit={handleSubmit} className="space-y-2">
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="Add a comment…"
                className="min-h-[80px] w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                maxLength={2000}
                disabled={submitting}
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={submitting || !newBody.trim()}>
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-1.5" />
                      Add comment
                    </>
                  )}
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-xs text-gray-500">Log in to add a comment.</p>
          )}
        </>
      )}
    </div>
  );
}
