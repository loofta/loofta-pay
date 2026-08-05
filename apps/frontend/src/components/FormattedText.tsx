"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Schema } from "hast-util-sanitize";

// Underline has no markdown syntax — the toolbar writes a raw <u> tag, so the sanitize schema
// needs to explicitly allow it (rehype-raw parses the raw HTML the markdown pipeline otherwise
// leaves untouched, rehype-sanitize strips everything not on this list — this is what makes it
// safe to render arbitrary user-entered text with dangerouslySetInnerHTML-equivalent power).
const SCHEMA: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "u"],
};

/** Renders a giveaway description (or any short user-entered text) written with the small RTE in
 *  RichTextEditor.tsx: bold/italic/strikethrough/links via markdown, underline via a sanitized
 *  raw <u> tag, emoji as plain unicode. Never renders raw HTML beyond this fixed allowlist. */
export function FormattedText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        // remarkGfm: strikethrough/links/tables. remarkBreaks: a single Enter in the textarea
        // becomes a real line break instead of CommonMark's default (collapsed to a space) — a
        // plain description box should behave like a chat input, not a strict markdown document,
        // and a blank line (double Enter) still starts a new <p> below.
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SCHEMA]]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-[#FF7A2A] hover:text-[#ffa15c]">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
