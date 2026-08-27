"use client";

// Folded into /docs (the "API key & branding" section) so key management, branding, and the
// "Try it" demos all live in the same docs-style page the rest of the API reference already
// uses, instead of three separate cramped standalone pages. This route stays as a redirect so
// existing links (Profile page, Footer, bookmarks) keep working.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DeveloperPageRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/docs?p=api-key");
  }, [router]);
  return null;
}
