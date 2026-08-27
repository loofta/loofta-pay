"use client";

// Folded into /docs (the "Try it" section, demo-store part) alongside the pay-button-config
// tester, so both live demos and the API key/branding setup all live in the same docs-style
// page. This route stays as a redirect so existing links and bookmarks (including ones carrying
// ?key=) keep working.

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Same sessionStorage slot ApiKeySetup.tsx (RAW_KEY_STORAGE_KEY) reads/writes — kept as a literal
// here rather than importing across the app/docs boundary for this one-time hand-off.
const RAW_KEY_STORAGE_KEY = "loofta-dev-raw-key";

function DemoStoreRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const key = searchParams.get("key");
    if (key && typeof window !== "undefined") {
      window.sessionStorage.setItem(RAW_KEY_STORAGE_KEY, key);
    }
    router.replace("/docs?p=try-it");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function DemoStorePageRedirect() {
  return (
    <Suspense fallback={null}>
      <DemoStoreRedirectInner />
    </Suspense>
  );
}
