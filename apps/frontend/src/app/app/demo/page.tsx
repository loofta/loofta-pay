"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Loader2, ExternalLink } from "lucide-react";
import { PayButton } from "@/components/sdk";
import { createPaymentLinkWithKey, type CreatedPaymentLink } from "@/services/api/paymentLinks";

function DemoPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [apiKey, setApiKey] = useState(() => searchParams.get("key") ?? "");

  // If a key arrived via ?key= (e.g. the "Pay button config" link from Developer settings), drop it
  // from the URL right after reading it once — no reason for a live API key to sit in the address
  // bar or browser history any longer than the initial navigation.
  useEffect(() => {
    if (searchParams.get("key")) {
      router.replace("/app/demo", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [amount, setAmount] = useState("25");
  const [message, setMessage] = useState("Sample payment link");
  const [buttonText, setButtonText] = useState("Pay with Loofta");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [returnUrl, setReturnUrl] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<CreatedPaymentLink | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    setLink(null);
    try {
      if (!apiKey.trim()) throw new Error("Paste your API key first (generate one in Developer settings).");
      const amountNum = Number(amount);
      if (!amountNum || amountNum < 1) throw new Error("Minimum is $1.");
      // No "private" toggle here — a payment link's own is_private only ever forces the *sender*
      // to pay privately. Privacy that actually matters, protecting the recipient's real wallet,
      // is a claim-time choice the recipient makes regardless of how it was sent (see the FAQ on
      // the claim page: "whoever receives it chooses at claim time, regardless of how it was
      // sent"). So there's nothing worth configuring here.
      const created = await createPaymentLinkWithKey(apiKey.trim(), {
        amount: amountNum,
        message: message || undefined,
        isPrivate: false,
        webhookUrl: webhookUrl.trim() || undefined,
        returnUrl: returnUrl.trim() || undefined,
      });
      setLink(created);
    } catch (e: any) {
      setError(e?.message || "Could not create payment link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <Link href="/app/developer" className="text-base text-slate-400 hover:text-white mb-4 inline-block">
          ← Developer
        </Link>
        <h1 className="text-2xl font-medium text-white mb-2">Pay button config</h1>
        <p className="text-base text-slate-400 mb-6">
          Configure every <code className="text-orange-300">POST /payment-links</code> field by hand
          and inspect the raw response — useful for testing, not a pattern to copy as-is (a real
          storefront generates one fresh link per order, from its own backend). For the actual
          integration pattern, see the{" "}
          <Link href="/app/demo-store" className="text-orange-400 hover:underline">demo store</Link>.
        </p>

        {/* Config */}
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-4 space-y-4">
          <div>
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

          <div>
            <label className="text-base text-slate-400 mb-1 block">Amount (USD)</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
            />
          </div>

          <div>
            <label className="text-base text-slate-400 mb-1 block">Message</label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
            />
          </div>

          <div>
            <label className="text-base text-slate-400 mb-1 block">Button text</label>
            <input
              type="text"
              value={buttonText}
              onChange={(e) => setButtonText(e.target.value)}
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
            />
          </div>

          <div>
            <label className="text-base text-slate-400 mb-1 block">Webhook URL (optional)</label>
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://your-server.com/webhooks/loofta"
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
            />
            <p className="text-base text-slate-400 mt-1">
              POSTed with a signed "payment.succeeded" event once this link is paid. A one-time
              secret to verify it comes back with the created link.
            </p>
          </div>

          <div>
            <label className="text-base text-slate-400 mb-1 block">Return URL (optional)</label>
            <input
              type="text"
              value={returnUrl}
              onChange={(e) => setReturnUrl(e.target.value)}
              placeholder="https://your-store.com/order-confirmed"
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
            />
            <p className="text-base text-slate-400 mt-1">
              Where the checkout page sends the buyer once paid (?payment=success&amp;short_id=...
              appended) — works even if the link is opened directly, not just through PayButton.
            </p>
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Create payment link
          </button>
          {error && <p className="text-base text-red-400">{error}</p>}
        </div>

        {/* Live preview */}
        {link && (
          <div className="rounded-xl bg-white/5 border border-white/10 p-4">
            <p className="text-base font-semibold text-white mb-3">Your embeddable button</p>
            <div className="flex justify-center py-4 mb-3 rounded-lg bg-black/20">
              <PayButton
                checkoutUrl={link.url}
                buttonText={buttonText || `Pay $${link.amount}`}
                openMode="tab"
                onSuccess={(paymentId) => console.log("Paid:", paymentId)}
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg bg-black/30 px-3 py-2 mb-2">
              <code className="text-base text-slate-300 truncate">{link.url}</code>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white shrink-0">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            {link.webhook_secret && (
              <div className="mb-2 rounded-lg bg-amber-500/10 border border-amber-400/30 p-3">
                <p className="text-base font-medium text-amber-200 mb-1">Webhook secret — shown once</p>
                <code className="text-base text-white break-all">{link.webhook_secret}</code>
              </div>
            )}
            <pre className="text-base text-slate-400 bg-black/40 rounded-lg p-3 overflow-x-auto">
{`<PayButton
  checkoutUrl="${link.url}"
  buttonText="${buttonText || `Pay $${link.amount}`}"
/>`}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DemoPage() {
  return (
    <Suspense fallback={null}>
      <DemoPageInner />
    </Suspense>
  );
}
