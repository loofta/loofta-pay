"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, Link2 } from "lucide-react";

type Props = {
  inviteLink: string;
  onCopy?: () => void;
};

export function InviteLinkShare({ inviteLink, onCopy }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onCopy?.();
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 space-y-3">
      <div className="flex items-center gap-2 text-emerald-800">
        <Link2 className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">Invite link ready</span>
      </div>
      <p className="text-sm text-emerald-700/90">
        Send this link to the freelancer so they can view the deal and accept, decline, or request changes.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          value={inviteLink}
          className="flex-1 min-w-0 rounded-md border border-emerald-200/80 bg-white px-3 py-2 text-sm text-gray-800 font-mono select-all"
          onFocus={(e) => e.target.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopy}
          className="shrink-0 border-emerald-300 bg-white hover:bg-emerald-50 hover:border-emerald-400"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 mr-2 text-emerald-600" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4 mr-2" />
              Copy link
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
