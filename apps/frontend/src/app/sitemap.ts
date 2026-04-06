import type { MetadataRoute } from "next";

const SITE_URL = (process as any)?.env?.NEXT_PUBLIC_SITE_URL || "https://loofta.xyz";

export default function sitemap(): MetadataRoute.Sitemap {
  const urls: string[] = [
    "/",
    "/history",
    "/settings",
    "/claim",
    "/lottery",
  ];
  const now = new Date();
  return urls.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: path === "/" ? 1 : 0.6,
  }));
}


