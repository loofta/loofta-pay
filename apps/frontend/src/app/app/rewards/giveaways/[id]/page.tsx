import type { Metadata } from "next";
import { getGiveawayPreview } from "@/lib/giveawayPreview";
import GiveawayDetailClient from "./GiveawayDetailClient";

const SITE_URL = "https://pay.loofta.xyz";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const preview = await getGiveawayPreview(id);
  if (!preview) {
    return { title: "Giveaway not found — Loofta" };
  }

  const title = `${preview.title} — $${preview.prize_amount_usd} × ${preview.winner_count} winners on Loofta`;
  const description = "Enter this giveaway on Loofta — funded, verified, and paid out automatically.";
  const imageUrl = `${SITE_URL}/api/giveaways/${id}/og`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function GiveawayDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GiveawayDetailClient id={id} />;
}
