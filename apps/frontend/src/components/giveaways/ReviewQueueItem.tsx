"use client";

import { useState } from "react";
import { Check, X, ExternalLink } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export interface ReviewQueueItemData {
  id: string;
  submission_data: Record<string, unknown> | null;
  verification_status: string;
  entry: { x_handle: string };
  task: { task_type: string; config?: { target?: string } };
}

interface ReviewQueueItemProps {
  item: ReviewQueueItemData;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busy?: boolean;
}

// Shared between the creator's Manage page and the password-protected public review page — same
// card, same click-to-open-in-new-tab behavior for both the submitted screenshot and the task's
// own target link, so a reviewer never has to guess what they're looking at or copy/paste a URL.
export function ReviewQueueItem({ item, onApprove, onReject, busy }: ReviewQueueItemProps) {
  const [zoomed, setZoomed] = useState(false);
  const proofImageUrl = typeof item.submission_data?.proof_image_url === "string" ? item.submission_data.proof_image_url : null;
  const proofText = typeof item.submission_data?.proof === "string" ? item.submission_data.proof : null;
  const taskLink = item.task.config?.target || null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-start gap-3">
          {proofImageUrl && (
            <button type="button" onClick={() => setZoomed(true)} className="shrink-0" title="Zoom in on screenshot">
              {/* eslint-disable-next-line @next/next/no-img-element -- review-only thumbnail, not worth the next/image plumbing here */}
              <img src={proofImageUrl} alt="Submitted proof" className="w-14 h-14 rounded-lg object-cover border border-white/10 hover:opacity-80 transition-opacity" />
            </button>
          )}
          <div className="min-w-0">
            <p className="text-base font-medium text-white">@{item.entry.x_handle} — {item.task.task_type.replace(/_/g, " ")}</p>
            {proofText && (
              <p className="text-base text-slate-500 truncate">
                {/^https?:\/\//i.test(proofText) ? (
                  <a href={proofText} target="_blank" rel="noopener noreferrer" className="text-[#FF7A2A] hover:underline underline-offset-2 inline-flex items-center gap-1">
                    {proofText} <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ) : (
                  proofText
                )}
              </p>
            )}
            {taskLink && (
              <a href={taskLink} target="_blank" rel="noopener noreferrer" className="text-base text-slate-500 hover:text-[#FF7A2A] underline underline-offset-2 inline-flex items-center gap-1">
                View task <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => onApprove(item.id)}
            className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            aria-label="Approve"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onReject(item.id)}
            className="p-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            aria-label="Decline"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {proofImageUrl && (
        <Dialog open={zoomed} onOpenChange={setZoomed}>
          <DialogContent className="max-w-3xl w-fit p-2 bg-[#0f0f12] border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element -- same review-only proof image, just zoomed in place instead of a new tab */}
            <img src={proofImageUrl} alt="Submitted proof, zoomed" className="max-w-full max-h-[80vh] rounded-lg object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
