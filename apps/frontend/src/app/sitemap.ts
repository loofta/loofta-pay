import type { MetadataRoute } from "next";

const SITE_URL = (process as any)?.env?.NEXT_PUBLIC_SITE_URL || "https://loofta.xyz";

export default function sitemap(): MetadataRoute.Sitemap {
  const urls: string[] = [
    "/",
    "/pay-with-email",
    "/payment-links",
    "/partners",
    "/guides/send-crypto-privately",
    "/vs/paypal",
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
  };
  const now = new Date();
  return urls.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: priority[path] ?? 0.5,
  }));
}


