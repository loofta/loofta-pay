import type { ReactNode } from "react";

/** Colours for code in the portal. Tokens are found in one pass, so a quote inside a comment stays a comment. */
const C = { keyword: "#FF8A5C", string: "#7FE0AE", comment: "#7C7C88", number: "#F2C26B", fn: "#8FB2FF", prop: "#D7D7DE", punct: "#9C9CA5", text: "#EDEDEF" };

const KEYWORDS = "import|from|export|const|let|var|await|async|new|return|function|if|else|true|false|null|undefined|type|interface|curl|POST|GET|DELETE|PATCH";
const TOKEN = new RegExp(
  [
    "(?<comment>\\/\\/[^\\n]*|#[^\\n]*)",
    "(?<string>\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)",
    "(?<number>\\b\\d+(?:\\.\\d+)?\\b)",
    `(?<keyword>\\b(?:${KEYWORDS})\\b)`,
    "(?<fn>[A-Za-z_$][\\w$]*(?=\\())",
    "(?<prop>(?<=\\.)[A-Za-z_$][\\w$]*)",
    "(?<punct>[{}()\\[\\],;:=<>+\\-*/|&!?]+)",
  ].join("|"),
  "g",
);

/** Splits code into coloured spans. Works for TypeScript, JSON, shell and similar. */
export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of code.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(code.slice(last, idx));
    const kind = Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0] as keyof typeof C | undefined;
    out.push(
      <span key={k++} style={{ color: kind ? C[kind] : C.text, fontStyle: kind === "comment" ? "italic" : undefined }}>
        {m[0]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
