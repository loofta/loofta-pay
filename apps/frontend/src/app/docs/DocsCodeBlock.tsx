"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function DocsCodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden my-4">
      {label && (
        <div className="px-4 py-2 border-b border-white/10 text-base font-medium text-slate-400">{label}</div>
      )}
      <div className="relative">
        <pre className="text-base text-slate-200 p-4 overflow-x-auto whitespace-pre">{code}</pre>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="absolute top-2 right-2 p-1.5 rounded-md bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white transition-colors"
          aria-label="Copy"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
