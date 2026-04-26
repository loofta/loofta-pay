import { notFound } from "next/navigation";
import type { Metadata } from "next";
import AdminDashboard from "./AdminDashboard";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ adminHash: string }> };

export default async function AdminHashPage({ params }: Props) {
  const { adminHash } = await params;
  const secretPath = process.env.ADMIN_SECRET_PATH;

  if (!secretPath || adminHash !== secretPath) {
    notFound();
  }

  return <AdminDashboard />;
}
