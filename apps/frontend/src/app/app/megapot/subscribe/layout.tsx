import { redirect } from "next/navigation";

// Ticket subscriptions are switched off for now; the page and backend stay in place so they can
// be re-enabled by deleting this layout and restoring the banner on the Megapot page.
export default function SubscribeLayout(_props: { children: React.ReactNode }) {
  redirect("/app/megapot");
}
