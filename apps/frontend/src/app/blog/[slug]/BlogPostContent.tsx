"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import type { BlogPostMeta } from "@/lib/blog";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function BlogPostContent({
  meta,
  content,
}: {
  meta: BlogPostMeta;
  content: string;
}) {
  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#0a0a0c] pb-40 relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-32 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.06] blur-[120px]" />

        <article className="relative max-w-3xl mx-auto px-4 md:px-8 pt-24 md:pt-32">
          <div className="mb-12">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white mb-8 ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              Blog
            </span>

            <h1 className="font-display text-[clamp(2rem,4vw,2.75rem)] font-medium leading-[1.15] tracking-[-0.03em] text-white mb-4">
              {meta.title}
            </h1>

            <p className="text-[13px] font-medium text-slate-500">{formatDate(meta.publishedAt)}</p>
          </div>

          <div
            className="font-grotesk text-[16px] leading-[1.8] text-slate-400
              [&>h2]:font-display [&>h2]:text-white [&>h2]:text-2xl [&>h2]:font-semibold [&>h2]:mt-12 [&>h2]:mb-4
              [&>h3]:font-display [&>h3]:text-white [&>h3]:text-xl [&>h3]:font-semibold [&>h3]:mt-8 [&>h3]:mb-3
              [&>p]:mb-5 [&>ul]:mb-5 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:flex [&>ul]:flex-col [&>ul]:gap-2
              [&>ol]:mb-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:flex [&>ol]:flex-col [&>ol]:gap-2
              [&_strong]:text-white [&_strong]:font-semibold
              [&_a]:underline [&_a]:text-[#FF7A2A] hover:[&_a]:text-[#ffa15c]"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>

          <a
            href={meta.ctaHref ?? APP_URL}
            className={`mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
          >
            {meta.ctaLabel ?? "Try Loofta"}
            <span className="text-white/70">→</span>
          </a>
        </article>
      </main>
      <Footer />
    </>
  );
}
