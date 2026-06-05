import { notFound } from "next/navigation";
import type { Metadata } from "next";
import OutreachDashboard from "./OutreachDashboard";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ adminHash: string }> };

export default async function OutreachPage({ params }: Props) {
  const { adminHash } = await params;
  if (!process.env.ADMIN_SECRET_PATH || adminHash !== process.env.ADMIN_SECRET_PATH) {
    notFound();
  }
  return <OutreachDashboard adminHash={adminHash} />;
}
