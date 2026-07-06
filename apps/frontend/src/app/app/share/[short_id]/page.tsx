import type { Metadata } from "next";
import { getSharePreview } from "@/lib/sharePreview";
import ShareClient from "./ShareClient";

const SITE_URL = "https://pay.loofta.xyz";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ short_id: string }>;
}): Promise<Metadata> {
  const { short_id } = await params;
  const preview = await getSharePreview(short_id);
  if (!preview) {
    return { title: "Payment link not found — Loofta Pay" };
  }

  const amount = preview.amount_usd % 1 === 0 ? `$${preview.amount_usd}` : `$${preview.amount_usd.toFixed(2)}`;
  const sender = preview.sender_username ? `@${preview.sender_username}` : "Someone";
  const recipient = preview.recipient_username ? `@${preview.recipient_username}` : "someone";
  const title = `${sender} sent ${amount} to ${recipient} on Loofta`;
  const imageUrl = `${SITE_URL}/api/share/${short_id}/og`;

  return {
    title,
    description: "Send and receive private payments on Loofta.",
    openGraph: {
      title,
      description: "Send and receive private payments on Loofta.",
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      images: [imageUrl],
    },
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ short_id: string }>;
}) {
  const { short_id } = await params;
  return <ShareClient short_id={short_id} />;
}
