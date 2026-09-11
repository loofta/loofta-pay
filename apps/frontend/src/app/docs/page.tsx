"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { DOCS_NAV } from "./docsNav";
import { Intro } from "./sections/Intro";
import { Authentication } from "./sections/Authentication";
import { ReceivePayments } from "./sections/ReceivePayments";
import { CheckoutPage } from "./sections/CheckoutPage";
import { CodeExamples } from "./sections/CodeExamples";
import { AgentSkill } from "./sections/AgentSkill";
import { SendPayments } from "./sections/SendPayments";
import { Whitelabel } from "./sections/Whitelabel";
import { ApiKeySetup } from "./sections/ApiKeySetup";
import { TryIt } from "./sections/TryIt";

// All doc content lives in ./sections as plain components, not separate routes — clicking the
// sidebar just swaps which one is rendered (instant, client-side only), instead of every doc
// topic being its own Next.js page that needs a fresh server round-trip to navigate to.
function DocsBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeSlug, setActiveSlug] = useState(() => searchParams.get("p") ?? "");

  const navigate = useCallback(
    (slug: string) => {
      setActiveSlug(slug);
      // Keep the URL shareable/bookmarkable, but this is a same-page query update, not a route
      // change — no new page segment to fetch, so it doesn't add any latency to the switch above.
      router.replace(slug ? `/docs?p=${slug}` : "/docs", { scroll: false });
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    },
    [router],
  );

  const content = useMemo(() => {
    switch (activeSlug) {
      case "authentication":
        return <Authentication onNavigate={navigate} />;
      case "api-key":
        return <ApiKeySetup onNavigate={navigate} />;
      case "try-it":
        return <TryIt onNavigate={navigate} />;
      case "receive-payments":
        return <ReceivePayments onNavigate={navigate} />;
      case "checkout-page":
        return <CheckoutPage />;
      case "code-examples":
        return <CodeExamples onNavigate={navigate} />;
      case "agent-skill":
        return <AgentSkill />;
      case "send-payments":
        return <SendPayments onNavigate={navigate} />;
      case "whitelabel":
        return <Whitelabel onNavigate={navigate} />;
      default:
        return <Intro onNavigate={navigate} />;
    }
  }, [activeSlug, navigate]);

  return (
    <main className="min-h-screen bg-[#111114] text-slate-100">
      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-10 pb-24 flex gap-10">
        {/* Sidebar */}
        <nav className="hidden md:block w-60 shrink-0 sticky top-24 self-start">
          <div className="mb-6">
            <p className="text-base font-medium text-slate-300 uppercase tracking-wide mb-2">Developer</p>
          </div>
          {DOCS_NAV.map((group) => (
            <div key={group.section} className="mb-6">
              <p className="text-base font-medium text-slate-400 uppercase tracking-wide mb-2 px-2">{group.section}</p>
              <div className="space-y-0.5">
                {group.pages.map((page) => {
                  const active = activeSlug === page.slug;
                  return (
                    <button
                      key={page.slug || "intro"}
                      type="button"
                      onClick={() => navigate(page.slug)}
                      className={[
                        "block w-full text-left px-2 py-1.5 rounded-lg text-base transition-colors",
                        active ? "bg-white/10 text-slate-100 font-medium" : "text-slate-300 hover:text-slate-100 hover:bg-white/5",
                      ].join(" ")}
                    >
                      {page.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Content */}
        <div className="min-w-0 flex-1 max-w-2xl">{content}</div>
      </div>
    </main>
  );
}

export default function DocsPage() {
  return (
    <>
      <MinimalHeader />
      <Suspense fallback={null}>
        <DocsBody />
      </Suspense>
      <Footer />
    </>
  );
}
