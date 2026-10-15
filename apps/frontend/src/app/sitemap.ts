import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";

const SITE_URL = (process as any)?.env?.NEXT_PUBLIC_SITE_URL || "https://loofta.xyz";

export default function sitemap(): MetadataRoute.Sitemap {
  const urls: string[] = [
    "/",
    "/pay-with-email",
    "/payment-links",
    "/partners",
    "/guides/send-crypto-privately",
    "/vs/paypal",
    "/usdc-to-ngn",
    "/dollar-to-naira-today",
    "/blog",
    "/about",
    "/careers",
    "/brand",
    "/privacy",
    "/terms",
  ];
  const priority: Record<string, number> = {
    "/": 1,
    "/pay-with-email": 0.9,
    "/payment-links": 0.9,
    "/partners": 0.9,
    "/guides/send-crypto-privately": 0.8,
    "/vs/paypal": 0.8,
    "/usdc-to-ngn": 0.9,
    "/dollar-to-naira-today": 1,
    "/blog": 0.7,
  };
  const dailyPaths = new Set(["/usdc-to-ngn", "/dollar-to-naira-today"]);
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = urls.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: dailyPaths.has(path) ? "daily" : path === "/" ? "weekly" : "monthly",
    priority: priority[path] ?? 0.5,
  }));

  // getAllPosts() already filters out future-dated posts, so a scheduled post drops off the
  // sitemap until its publishedAt date passes — no redeploy needed for it to appear.
  const blogEntries: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.publishedAt),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticEntries, ...blogEntries];
}


