import type { Metadata } from "next";
import { getGiftSharePreview } from "@/lib/giftSharePreview";
import GiftShareClient from "./GiftShareClient";

const SITE_URL = "https://pay.loofta.xyz";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const preview = await getGiftSharePreview(token);
  if (!preview) {
    return { title: "Gift link not found — Loofta" };
  }

  const ticketWord = preview.numTickets === 1 ? "ticket" : "tickets";
  const title = `You've been gifted ${preview.numTickets} Megapot ${ticketWord} on Loofta`;
  const description = "Loofta covers the cost — claim it privately.";
  const imageUrl = `${SITE_URL}/api/gift/${token}/og`;

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
      images: [imageUrl],
    },
  };
}

export default async function GiftSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <GiftShareClient token={token} />;
}
