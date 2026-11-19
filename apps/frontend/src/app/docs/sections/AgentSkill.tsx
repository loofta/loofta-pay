"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { LOOFTA_PARTNER_PAYOUTS_SKILL, LOOFTA_PAYMENT_LINKS_SKILL } from "../skillContent";

const SKILLS = [
  {
    id: "payment-links",
    tab: "Payment links",
    folder: "loofta-payment-links",
    blurb: "Accept payments with checkout links, and pay a single person by email or handle.",
    content: LOOFTA_PAYMENT_LINKS_SKILL,
  },
  {
    id: "partner-payouts",
    tab: "Partner payouts",
    folder: "loofta-partner-payouts",
    blurb: "Pay many people in bulk from your platform, and show users their earnings.",
    content: LOOFTA_PARTNER_PAYOUTS_SKILL,
  },
] as const;

export function AgentSkill() {
  const [active, setActive] = useState<(typeof SKILLS)[number]["id"]>("payment-links");
  const [copied, setCopied] = useState(false);
  const skill = SKILLS.find((s) => s.id === active) ?? SKILLS[0];

  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Agent skills</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Copy a skill into your coding agent (for example as{" "}
        <code className="text-orange-300">.claude/skills/{skill.folder}/SKILL.md</code>) so it can wire up Loofta for you.
      </p>

      <div className="mb-4 inline-flex rounded-full bg-white/5 p-1" role="tablist">
        {SKILLS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active === s.id}
            onClick={() => {
              setActive(s.id);
              setCopied(false);
            }}
            className={`rounded-full px-4 py-1.5 text-base font-medium transition-colors ${active === s.id ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}
          >
            {s.tab}
          </button>
        ))}
      </div>
      <p className="mb-4 text-base text-slate-400">{skill.blurb}</p>

      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(skill.content);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied ? "Copied" : "Copy SKILL.md"}
      </button>

      <pre className="text-base text-slate-200 bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap">
        {skill.content}
      </pre>
    </article>
  );
}
