"use client";

/**
 * A fake storefront, not a config form — see /app/demo for the raw "paste a key, tweak every
 * field, get a link" tool this reuses under the hood (createPaymentLinkWithKey). This exists to
 * show the actual end-to-end shape of a real integration: a fixed-price product, a single "Buy
 * now" button, and a *fresh* checkout link generated per click — never reused across purchases,
 * matching how POST /payment-links is meant to be called (once per order, not once ever).
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Loader2, ShoppingBag } from "lucide-react";
import { createPaymentLinkWithKey } from "@/services/api/paymentLinks";

const PRODUCT_PRICE = 5;
const PRODUCT_NAME = "Loofta Demo Tee";
const PRODUCT_DESCRIPTION = "100% cotton. Not a real product — every purchase here just proves out a real checkout link.";

function DemoStorePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [apiKey, setApiKey] = useState(() => searchParams.get("key") ?? "");

  // Same reasoning as /app/demo: don't let a live API key linger in the URL bar/history.
  useEffect(() => {
    if (searchParams.get("key")) {
      router.replace("/app/demo-store", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBuyNow() {
    setError(null);
    if (!apiKey.trim()) {
      setError("Paste your API key first (generate one in Developer settings).");
      return;
    }
    setBuying(true);
    try {
      // A fresh link per click — this is the part that matters: a real store never reuses one
      // checkout URL across orders, it calls this at the moment of purchase, every time.
      // Private by default (payment-links.service.ts's own default) — $5 happens to be exactly
      // the private-link minimum, so this doubles as a real test of the private-payment flow
      // (USDC on Solana / Pay with Loofta only, sign-in-gated for a guest — see GuestCheckoutPay).
      const link = await createPaymentLinkWithKey(apiKey.trim(), {
        amount: PRODUCT_PRICE,
        message: `Order: ${PRODUCT_NAME}`,
        isPrivate: true,
      });
      window.location.href = link.url;
    } catch (e: any) {
      setError(e?.message || "Could not start checkout");
      setBuying(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <Link href="/app/demo" className="text-base text-slate-400 hover:text-white mb-4 inline-block">
          ← Raw demo (config every field)
        </Link>
        <h1 className="text-2xl font-medium text-white mb-2">Demo store</h1>
        <p className="text-base text-slate-400 mb-6">
          What a real integration looks like from the buyer's side: one product, one price,
          one button — pressing it calls <code className="text-orange-300">POST /payment-links</code>{" "}
          right then and sends you to a brand-new checkout link.
        </p>

        {!apiKey.trim() && (
          <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-4">
            <label className="text-base text-slate-400 mb-1 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> API key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="lft_test_..."
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
            />
            <p className="text-base text-slate-500 mt-1">
              Not saved anywhere — only kept in this page while it's open. Get one from{" "}
              <Link href="/app/developer" className="text-orange-400 hover:underline">Developer settings</Link>.
            </p>
          </div>
        )}

        <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden">
          <div className="aspect-square flex items-center justify-center bg-gradient-to-br from-orange-500/20 to-amber-500/10">
            <ShoppingBag className="w-20 h-20 text-orange-300/60" strokeWidth={1.25} />
          </div>
          <div className="p-5 space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-white">{PRODUCT_NAME}</h2>
              <p className="text-base text-slate-400 mt-1">{PRODUCT_DESCRIPTION}</p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-2xl font-semibold text-white">${PRODUCT_PRICE.toFixed(2)}</span>
              <button
                type="button"
                onClick={handleBuyNow}
                disabled={buying}
                className="flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50"
              >
                {buying && <Loader2 className="w-4 h-4 animate-spin" />}
                {buying ? "Starting checkout…" : "Buy now"}
              </button>
            </div>
            {error && <p className="text-base text-red-400">{error}</p>}
          </div>
        </div>

        <p className="text-base text-slate-500 mt-4">
          Every click here is a real, private payment link against your account — $5 is exactly
          the private-link minimum, chosen on purpose. Check{" "}
          <Link href="/app/history" className="text-orange-400 hover:underline">your history</Link> after paying to see it land.
        </p>
      </div>
    </div>
  );
}

export default function DemoStorePage() {
  return (
    <Suspense fallback={null}>
      <DemoStorePageInner />
    </Suspense>
  );
}
