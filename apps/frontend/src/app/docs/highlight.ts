/**
 * A small, dependency-free syntax highlighter for the developer docs. It only needs to make short
 * snippets (curl, TypeScript, JSON, HTML) easy to read, so each language is one ordered regex.
 */
export type Lang = "bash" | "ts" | "json" | "html" | "text";
export type TokenKind = "comment" | "string" | "keyword" | "number" | "fn" | "prop" | "flag" | "tag" | "attr" | "plain";
export interface Token {
  text: string;
  kind: TokenKind;
}

const TS_KEYWORDS =
  "import|export|from|const|let|var|function|return|await|async|new|if|else|for|of|in|while|try|catch|throw|class|extends|type|interface|default|true|false|null|undefined|typeof|void|as";

// Order matters: the first alternative that matches at a position wins.
const RULES: Record<Exclude<Lang, "text">, Array<[TokenKind, RegExp]>> = {
  ts: [
    ["comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ["string", /`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y],
    ["number", /\b\d[\d_]*(?:\.\d+)?\b/y],
    ["keyword", new RegExp(`\\b(?:${TS_KEYWORDS})\\b`, "y")],
    ["fn", /[A-Za-z_$][\w$]*(?=\s*\()/y],
    ["prop", /[A-Za-z_$][\w$]*(?=\s*:)/y],
  ],
  bash: [
    ["comment", /#[^\n]*/y],
    ["string", /"(?:\\.|[^"\\])*"|'[^']*'/y],
    ["flag", /(?<=\s)--?[A-Za-z][\w-]*/y],
    ["keyword", /\b(?:curl|export|npm|npx|pnpm|yarn|git|cd|echo)\b/y],
    ["fn", /\$[A-Z_][A-Z0-9_]*/y],
    ["number", /\b\d+\b/y],
  ],
  json: [
    ["prop", /"(?:\\.|[^"\\])*"(?=\s*:)/y],
    ["string", /"(?:\\.|[^"\\])*"/y],
    ["number", /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
    ["keyword", /\b(?:true|false|null)\b/y],
  ],
  html: [
    ["comment", /<!--[\s\S]*?-->/y],
    ["string", /"[^"]*"|'[^']*'/y],
    ["tag", /<\/?[A-Za-z][\w-]*|\/?>/y],
    ["attr", /[A-Za-z-]+(?==)/y],
  ],
};

/** Best guess at the language when the caller did not say. */
export function detectLang(code: string, hint?: string): Lang {
  const h = (hint ?? "").toLowerCase();
  if (/\b(bash|sh|shell|curl)\b/.test(h)) return "bash";
  if (/\b(json)\b/.test(h)) return "json";
  if (/\b(html)\b/.test(h)) return "html";
  if (/\b(ts|tsx|js|jsx|typescript|javascript)\b/.test(h)) return "ts";
  const t = code.trimStart();
  if (/^(curl|npm|npx|pnpm|yarn|git|export)\b/.test(t) || t.startsWith("$ ")) return "bash";
  if (/^[{[]/.test(t) && /"\s*:/.test(t)) return "json";
  if (/^<[A-Za-z!]/.test(t)) return "html";
  if (/\b(import|const|let|await|function|=>)\b/.test(t)) return "ts";
  return "text";
}

export function tokenize(code: string, lang: Lang): Token[] {
  if (lang === "text") return [{ text: code, kind: "plain" }];
  const rules = RULES[lang];
  const out: Token[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ text: plain, kind: "plain" }), (plain = "");
  };
  let i = 0;
  while (i < code.length) {
    let hit: Token | null = null;
    for (const [kind, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length > 0) {
        hit = { text: m[0], kind };
        break;
      }
    }
    if (hit) {
      flush();
      out.push(hit);
      i += hit.text.length;
    } else {
      plain += code[i];
      i += 1;
    }
  }
  flush();
  return out;
}

export const LANG_LABEL: Record<Lang, string> = { bash: "Shell", ts: "TypeScript", json: "JSON", html: "HTML", text: "Text" };
