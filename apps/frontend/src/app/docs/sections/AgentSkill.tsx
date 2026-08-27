"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { LOOFTA_PAYMENT_LINKS_SKILL } from "../skillContent";

export function AgentSkill() {
  const [copied, setCopied] = useState(false);

  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Agent skill</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Copy this into your coding agent (e.g. as <code className="text-orange-300">.claude/skills/loofta-payment-links/SKILL.md</code>)
        so it can wire up Loofta payment links and payouts for you.
      </p>

      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(LOOFTA_PAYMENT_LINKS_SKILL);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied ? "Copied" : "Copy SKILL.md"}
      </button>

      <pre className="text-base text-slate-200 bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap">
        {LOOFTA_PAYMENT_LINKS_SKILL}
      </pre>
    </article>
  );
}
