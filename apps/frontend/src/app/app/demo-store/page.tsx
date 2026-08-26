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
import { KeyRound, ShoppingBag } from "lucide-react";
import { createPaymentLinkWithKey } from "@/services/api/paymentLinks";
import { PayButton } from "@/components/sdk";

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

  // The actual thing worth demonstrating: PayButton's onGenerateLink calls this fresh, right at
  // click time — a real store never reuses one checkout URL across orders — then opens the result
  // in a popup and listens for the "loofta-payment-success" message the checkout page posts back
  // to window.opener once it settles, flipping itself to "Paid successfully" in place. A raw
  // window.location.href redirect (what this used to do) leaves the browser stranded on the
  // checkout page with no way back and no way for this button to ever learn it succeeded.
  // Errors (including the "paste your key first" one below) surface inline under the button —
  // that's PayButton's own generateError display, not something this page needs to duplicate.
  async function handleGenerateLink(): Promise<string> {
    if (!apiKey.trim()) {
      throw new Error("Paste your API key first (generate one in Developer settings).");
    }
    // Not private — privacy is always an opt-in choice the payer makes at payment time (the
    // "Pay privately" switch), never something a link mandates. A mandatory-private link locks
    // that switch into a non-interactive "all payments are private" state instead, which isn't
    // what this demo is meant to show.
    const link = await createPaymentLinkWithKey(apiKey.trim(), {
      amount: PRODUCT_PRICE,
      message: `Order: ${PRODUCT_NAME}`,
      isPrivate: false,
    });
    return link.url;
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <Link href="/app/demo" className="text-base text-slate-400 hover:text-white mb-4 inline-block">
          ← Pay button config
        </Link>
        <h1 className="text-2xl font-medium text-white mb-2">Demo store</h1>
        <p className="text-base text-slate-400 mb-6">
          What a real integration looks like from the buyer's side: one product, one price,
          one button — pressing it calls <code className="text-orange-300">POST /payment-links</code>{" "}
          right then, opens a brand-new checkout link in a popup, and updates itself once you pay.
          The other demo page is a field-by-field tester for the raw API — this page is the actual
          pattern to copy into your own storefront.
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
              placeholder="lft_live_..."
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
            />
            <p className="text-base text-slate-400 mt-1">
              Not saved anywhere — only kept in this page while it's open. Get one from{" "}
              <Link href="/app/developer" className="text-orange-400 hover:underline">Developer settings</Link>.
            </p>
          </div>
        )}

        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="flex gap-4">
            <div className="w-20 h-20 shrink-0 rounded-xl flex items-center justify-center bg-gradient-to-br from-orange-500/20 to-amber-500/10">
              <ShoppingBag className="w-8 h-8 text-orange-300/60" strokeWidth={1.25} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white">{PRODUCT_NAME}</h2>
              <p className="text-base text-slate-400 mt-1">{PRODUCT_DESCRIPTION}</p>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 mt-3 border-t border-white/10">
            <span className="text-2xl font-semibold text-white">${PRODUCT_PRICE.toFixed(2)}</span>
            <PayButton
              onGenerateLink={handleGenerateLink}
              buttonText={`Buy now — $${PRODUCT_PRICE.toFixed(2)}`}
              successText="Paid successfully!"
              openMode="popup"
            />
          </div>
        </div>

        <p className="text-base text-slate-400 mt-4">
          Every click here is a real payment link against your account. The button opens checkout
          in a popup and flips to "Paid successfully" on its own once it settles — no page reload,
          no manual redirect. Check <Link href="/app/history" className="text-orange-400 hover:underline">your history</Link> after paying to see it land.
        </p>

        <div className="rounded-xl bg-white/5 border border-white/10 p-4 mt-6">
          <p className="text-base font-semibold text-white mb-3">What "Buy now" actually does</p>
          <ol className="text-base text-slate-400 space-y-2 mb-4 list-decimal list-inside">
            <li>On click, your backend calls <code className="text-orange-300">POST /payment-links</code> with your API key — a fresh link, every time, never a reused URL.</li>
            <li>That response includes <code className="text-orange-300">short_id</code> right then, server-side — save it against your own order record now. There's no other moment to recover it later.</li>
            <li><code className="text-orange-300">PayButton</code> opens the returned <code className="text-orange-300">url</code> and waits for it to settle.</li>
            <li>Once paid, check <code className="text-orange-300">paid</code> from <code className="text-orange-300">GET /payment-links/&#123;short_id&#125;</code> (the one you saved in step 2) or your <code className="text-orange-300">webhook_url</code> before fulfilling the order — the button flipping to "Paid" is UI feedback only, not something to trust for that.</li>
          </ol>
          <pre className="text-base text-slate-400 bg-black/40 rounded-lg p-3 overflow-x-auto">
{`// Your backend — /api/create-checkout
const link = await client.createPaymentLink({ amount: 5, message: "Order #1042" });
await orders.save({ orderId: "1042", shortId: link.shortId }); // <- link.shortId, saved now
return Response.json({ url: link.url });

// Your frontend
async function handleGenerateLink() {
  const res = await fetch("/api/create-checkout", { method: "POST" });
  const { url } = await res.json();
  return url;
}

<PayButton onGenerateLink={handleGenerateLink} buttonText="Buy now" openMode="popup" />`}
          </pre>
          <p className="text-base text-slate-400 mt-3">
            Full reference: <Link href="/docs" className="text-orange-400 hover:underline">API docs</Link>, or{" "}
            <Link href="/docs?p=agent-skill" className="text-orange-400 hover:underline">copy the agent skill</Link> into your own coding agent.
          </p>
        </div>
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
