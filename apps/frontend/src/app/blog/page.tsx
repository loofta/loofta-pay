import type { Metadata } from "next";
import BlogIndexContent from "./BlogIndexContent";
import { getAllPosts } from "@/lib/blog";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Blog | Loofta",
  description:
    "Guides and explainers on sending money without a wallet, private crypto payments, and the Loofta lottery.",
  alternates: {
    canonical: "/blog",
  },
};

export default function Page() {
  const posts = getAllPosts();
  return <BlogIndexContent posts={posts} />;
}
