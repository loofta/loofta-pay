"use client";

import { useState } from "react";
import { KeyRound, Loader2, ExternalLink, ShoppingBag } from "lucide-react";
import { PayButton } from "@/components/sdk";
import { createPaymentLinkWithKey, type CreatedPaymentLink } from "@/services/api/paymentLinks";
import { RAW_KEY_STORAGE_KEY } from "./ApiKeySetup";

const PRODUCT_PRICE = 5;
const PRODUCT_NAME = "Loofta Demo Tee";
const PRODUCT_DESCRIPTION = "100% cotton. Not a real product — every purchase here just proves out a real checkout link.";

export function TryIt({ onNavigate }: { onNavigate: (slug: string) => void }) {
  // Picks up whatever key ApiKeySetup last generated this session — same sessionStorage slot,
  // read once on mount. Still editable here: someone may paste in a key generated elsewhere.
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem(RAW_KEY_STORAGE_KEY) ?? "";
  });

  const [amount, setAmount] = useState("25");
  const [message, setMessage] = useState("Sample payment link");
  const [buttonText, setButtonText] = useState("Pay with Loofta");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [returnUrl, setReturnUrl] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configLink, setConfigLink] = useState<CreatedPaymentLink | null>(null);

  // The actual thing worth demonstrating: PayButton's onGenerateLink calls this fresh, right at
  // click time — a real store never reuses one checkout URL across orders — then opens the result
  // in a popup and listens for the "loofta-payment-success" message the checkout page posts back
  // to window.opener once it settles, flipping itself to "Paid successfully" in place.
  async function handleGenerateStoreLink(): Promise<string> {
    if (!apiKey.trim()) {
      throw new Error("Paste your API key first (generate one above).");
    }
    // Not private — privacy is always an opt-in choice the payer makes at payment time (the
    // "Pay privately" switch), never something a link mandates.
    const link = await createPaymentLinkWithKey(apiKey.trim(), {
      amount: PRODUCT_PRICE,
      message: `Order: ${PRODUCT_NAME}`,
      isPrivate: false,
    });
    return link.url;
  }

  async function handleCreateConfigLink() {
    setConfigLoading(true);
    setConfigError(null);
    setConfigLink(null);
    try {
      if (!apiKey.trim()) throw new Error("Paste your API key first (generate one above).");
      const amountNum = Number(amount);
      if (!amountNum || amountNum < 1) throw new Error("Minimum is $1.");
      // No "private" toggle here — a payment link's own is_private only ever forces the *sender*
      // to pay privately. Privacy that actually matters, protecting the recipient's real wallet,
      // is a claim-time choice the recipient makes regardless of how it was sent.
      const created = await createPaymentLinkWithKey(apiKey.trim(), {
        amount: amountNum,
        message: message || undefined,
        isPrivate: false,
        webhookUrl: webhookUrl.trim() || undefined,
        returnUrl: returnUrl.trim() || undefined,
      });
      setConfigLink(created);
    } catch (e: any) {
      setConfigError(e?.message || "Could not create payment link");
    } finally {
      setConfigLoading(false);
    }
  }

  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Try it</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Create real payment links against your own account — every link below is live (mainnet)
        and calls <code className="text-orange-300">POST /payment-links</code> for real.
      </p>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-8">
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
          Not saved anywhere beyond this session. Don&apos;t have one yet?{" "}
          <button type="button" onClick={() => onNavigate("api-key")} className="text-orange-400 hover:underline">
            Generate a key
          </button>.
        </p>
      </div>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Demo store — the real integration pattern</h2>
      <p className="text-base text-slate-400 mb-4">
        One product, one price, one button — pressing it calls{" "}
        <code className="text-orange-300">POST /payment-links</code> right then, opens a
        brand-new checkout link in a popup, and updates itself once you pay. This is the pattern
        to copy into your own storefront: a fresh link per order, never a reused URL.
      </p>

      <div className="rounded-2xl bg-white/5 border border-white/10 p-4 mb-3">
        <div className="flex gap-4">
          <div className="w-20 h-20 shrink-0 rounded-xl flex items-center justify-center bg-gradient-to-br from-orange-500/20 to-amber-500/10">
            <ShoppingBag className="w-8 h-8 text-orange-300/60" strokeWidth={1.25} />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-white">{PRODUCT_NAME}</h3>
            <p className="text-base text-slate-400 mt-1">{PRODUCT_DESCRIPTION}</p>
          </div>
        </div>
        <div className="flex items-center justify-between pt-3 mt-3 border-t border-white/10">
          <span className="text-2xl font-semibold text-white">${PRODUCT_PRICE.toFixed(2)}</span>
          <PayButton
            onGenerateLink={handleGenerateStoreLink}
            buttonText={`Buy now — $${PRODUCT_PRICE.toFixed(2)}`}
            successText="Paid successfully!"
            openMode="popup"
          />
        </div>
      </div>
      <p className="text-base text-slate-400 mb-8">
        Check <a href="/app/history" className="text-orange-400 hover:underline">your history</a> after
        paying to see it land. See{" "}
        <button type="button" onClick={() => onNavigate("receive-payments")} className="text-orange-400 hover:underline">
          how to know it's paid
        </button>{" "}
        for the poll/webhook pattern behind this button's <code className="text-orange-300">onGenerateLink</code>.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Pay button config — field-by-field tester</h2>
      <p className="text-base text-slate-400 mb-4">
        Set every <code className="text-orange-300">POST /payment-links</code> field by hand and
        inspect the raw response — useful for testing, not a pattern to copy as-is (a real
        storefront generates one fresh link per order, from its own backend, as above).
      </p>

      <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-4 space-y-4">
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
            POSTed with a signed &quot;payment.succeeded&quot; event once this link is paid. A
            one-time secret to verify it comes back with the created link.
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
          onClick={handleCreateConfigLink}
          disabled={configLoading}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50"
        >
          {configLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          Create payment link
        </button>
        {configError && <p className="text-base text-red-400">{configError}</p>}
      </div>

      {configLink && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-6">
          <p className="text-base font-semibold text-white mb-3">Your embeddable button</p>
          <div className="flex justify-center py-4 mb-3 rounded-lg bg-black/20">
            <PayButton
              checkoutUrl={configLink.url}
              buttonText={buttonText || `Pay $${configLink.amount}`}
              openMode="tab"
              onSuccess={(paymentId) => console.log("Paid:", paymentId)}
            />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-black/30 px-3 py-2 mb-2">
            <code className="text-base text-slate-300 truncate">{configLink.url}</code>
            <a href={configLink.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white shrink-0">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          {configLink.webhook_secret && (
            <div className="mb-2 rounded-lg bg-amber-500/10 border border-amber-400/30 p-3">
              <p className="text-base font-medium text-amber-200 mb-1">Webhook secret — shown once</p>
              <code className="text-base text-white break-all">{configLink.webhook_secret}</code>
            </div>
          )}
          <pre className="text-base text-slate-400 bg-black/40 rounded-lg p-3 overflow-x-auto">
{`<PayButton
  checkoutUrl="${configLink.url}"
  buttonText="${buttonText || `Pay $${configLink.amount}`}"
/>`}
          </pre>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-slate-300 text-base">
          Full reference:{" "}
          <button type="button" onClick={() => onNavigate("receive-payments")} className="text-orange-400 hover:underline">
            create a payment link
          </button>{" "}
          or{" "}
          <button type="button" onClick={() => onNavigate("agent-skill")} className="text-orange-400 hover:underline">
            copy the agent skill
          </button>{" "}
          into your own coding agent.
        </p>
      </div>
    </article>
  );
}
