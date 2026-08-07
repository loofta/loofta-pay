"use client";

import Link from "next/link";
import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import type { BlogPostMeta } from "@/lib/blog";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function BlogIndexContent({ posts }: { posts: BlogPostMeta[] }) {
  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#0a0a0c] pb-40 relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-32 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.06] blur-[120px]" />

        <div className="relative max-w-3xl mx-auto px-4 md:px-8 pt-24 md:pt-32">
          <div className="mb-16">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white mb-8 ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              Blog
            </span>

            <h1 className="font-display text-[clamp(2.2rem,4.5vw,3.25rem)] font-medium leading-[1.1] tracking-[-0.03em] text-white mb-6">
              Guides and updates
            </h1>

            <p className="font-grotesk text-[17px] md:text-[19px] leading-[1.65] text-slate-400 max-w-xl">
              Sending money without a wallet, private crypto payments, and how the Loofta lottery works.
            </p>
          </div>

          {posts.length === 0 ? (
            <p className="font-grotesk text-[16px] text-slate-500">No posts yet — check back soon.</p>
          ) : (
            <div className="flex flex-col gap-8">
              {posts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group block border-b border-white/[0.06] pb-8 last:border-0"
                >
                  <p className="text-[13px] font-medium text-slate-500 mb-2">{formatDate(post.publishedAt)}</p>
                  <h2 className="font-display text-xl md:text-2xl font-semibold text-white mb-2 group-hover:text-[#FF7A2A] transition-colors">
                    {post.title}
                  </h2>
                  <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400">{post.description}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
