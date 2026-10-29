import { redirect } from "next/navigation";

/** The wallet page moved to /portfolio; keep old links and bookmarks working. */
export default async function LegacyWalletRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const qs = new URLSearchParams(Object.entries(await searchParams).filter(([, v]) => v) as [string, string][]).toString();
  redirect(`/app/portfolio${qs ? `?${qs}` : ""}`);
}
