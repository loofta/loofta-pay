import { redirect } from "next/navigation";

// Mystery Packs are switched off for now; the page and its backend stay in place so they can be
// re-enabled by deleting this layout.
export default function PacksLayout(_props: { children: React.ReactNode }) {
  redirect("/app/megapot");
}
