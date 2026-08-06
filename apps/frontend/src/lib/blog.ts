import fs from "fs";
import path from "path";
import matter from "gray-matter";

// Frontmatter schema for every file in src/content/blog/*.md:
//   title:       string  — page <title> and H1
//   description: string  — meta description, ~150-160 chars, also used as the index card summary
//   publishedAt: string  — "YYYY-MM-DD", gates visibility (see isPublished below)
//   canonical:   string  — optional, defaults to /blog/{slug}
// The slug is always the filename without ".md".

const BLOG_DIR = path.join(process.cwd(), "src/content/blog");

export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  canonical: string;
}

export interface BlogPost {
  meta: BlogPostMeta;
  content: string;
}

function isPublished(publishedAt: string): boolean {
  return new Date(publishedAt).getTime() <= Date.now();
}

function readSlugs(): string[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

function readPost(slug: string): BlogPost | null {
  const filePath = path.join(BLOG_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const meta: BlogPostMeta = {
    slug,
    title: data.title,
    description: data.description,
    publishedAt: data.publishedAt,
    canonical: data.canonical ?? `/blog/${slug}`,
  };
  return { meta, content };
}

/** Published posts only, newest first. Filters out future-dated posts at request time,
 *  so a post scheduled for tomorrow appears on its own without a redeploy. */
export function getAllPosts(): BlogPostMeta[] {
  return readSlugs()
    .map((slug) => readPost(slug))
    .filter((post): post is BlogPost => post !== null && isPublished(post.meta.publishedAt))
    .map((post) => post.meta)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

/** Returns null for a missing slug OR a post whose publishedAt is still in the future —
 *  callers should treat both cases as not-found. */
export function getPostBySlug(slug: string): BlogPost | null {
  const post = readPost(slug);
  if (!post || !isPublished(post.meta.publishedAt)) return null;
  return post;
}
