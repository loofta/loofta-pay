"use client";

import { useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";
import { detectLang, LANG_LABEL, tokenize, type Lang, type TokenKind } from "./highlight";

const COLOR: Record<TokenKind, string> = {
  plain: "text-slate-200",
  comment: "text-slate-500 italic",
  string: "text-emerald-300",
  keyword: "text-orange-300",
  number: "text-sky-300",
  fn: "text-amber-200",
  prop: "text-sky-200",
  flag: "text-violet-300",
  tag: "text-orange-300",
  attr: "text-sky-200",
};

/**
 * A code snippet with syntax colours, a language tag and a copy button. `label` is the caption shown
 * above it (a file name or a command). `lang` is picked from the code when you do not pass it.
 */
export function DocsCodeBlock({ code, label, lang }: { code: string; label?: string; lang?: Lang }) {
  const [copied, setCopied] = useState(false);
  const language = useMemo(() => lang ?? detectLang(code, label), [lang, code, label]);
  const tokens = useMemo(() => tokenize(code, language), [code, language]);

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-[#0B0B0E]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2">
        <span className="min-w-0 truncate font-mono text-[14px] text-slate-300">{label ?? LANG_LABEL[language]}</span>
        <div className="flex shrink-0 items-center gap-3">
          {label && language !== "text" && <span className="text-[13px] font-medium uppercase tracking-wide text-slate-500">{LANG_LABEL[language]}</span>}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Copy code"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[14.5px] leading-relaxed whitespace-pre">
        <code>
          {tokens.map((t, i) => (
            <span key={i} className={COLOR[t.kind]}>
              {t.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
