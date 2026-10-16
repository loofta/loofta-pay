import { DocsCodeBlock } from "../DocsCodeBlock";

export function CodeExamples({ onNavigate }: { onNavigate: (slug: string) => void }) {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Code examples</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Two ways in: raw HTTP, or the <code className="text-orange-300">@loofta/pay-sdk</code> package.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">curl</h2>
      <DocsCodeBlock
        code={`curl -X POST https://api.loofta.xyz/payment-links \\
  -H "Authorization: Bearer $LOOFTA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 25, "message": "Invoice #1042"}'`}
      />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">TypeScript / JavaScript SDK</h2>
      <DocsCodeBlock
        label="npm install @loofta/pay-sdk"
        code={`import { LooftaPayClient } from "@loofta/pay-sdk";

const client = new LooftaPayClient({ apiKey: process.env.LOOFTA_API_KEY });

const link = await client.createPaymentLink({
  amount: 25,
  message: "Invoice #1042",
});

console.log(link.url); // https://pay.loofta.com/checkout/aB3xK9pQ`}
      />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Embedding a checkout button</h2>
      <p className="text-base text-slate-400 mb-3">
        <code className="text-orange-300">@loofta/pay-sdk</code> is server-side only — it never
        exposes your API key to the browser, so it doesn't ship a React component either. Copy{" "}
        <code className="text-orange-300">components/sdk/PayButton.tsx</code> from the Loofta repo
        into your project, or write your own equivalent against a "create checkout" endpoint on
        your own backend. Real integration pattern — one fresh link per click, not one static URL
        reused across every order:
      </p>
      <DocsCodeBlock
        code={`<PayButton
  onGenerateLink={async () => {
    const res = await fetch("/api/create-checkout", { method: "POST" }); // your own backend, calls createPaymentLink server-side
    const { url } = await res.json();
    return url;
  }}
  buttonText="Buy now"
  onSuccess={(paymentId) => console.log("Paid:", paymentId)}
/>`}
      />
      <p className="text-base text-slate-400 mb-6">
        See the <button type="button" onClick={() => onNavigate("try-it")} className="text-orange-400 hover:underline">demo store</button>{" "}
        for this pattern actually wired up end to end.
      </p>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 mt-8">
        <p className="text-slate-300 text-base">
          Building with an AI coding agent? Grab the copyable{" "}
          <button type="button" onClick={() => onNavigate("agent-skill")} className="text-orange-400 hover:underline">
            agent skill
          </button>{" "}
          — it has all of this in a format Claude Code and similar tools can follow directly.
        </p>
      </div>
    </article>
  );
}
