import type { MetadataRoute } from "next";

const SITE_URL = (process as any)?.env?.NEXT_PUBLIC_SITE_URL || "https://loofta.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Allow OG image generation for social crawlers (see https://vercel.com/docs/og-image-generation)
      allow: ["/", "/api/og"],
      disallow: ["/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}


