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

console.log(link.url); // https://pay.loofta.xyz/checkout/aB3xK9pQ`}
      />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Embedding a checkout button</h2>
      <p className="text-base text-slate-400 mb-3">
        Create the link server-side (never expose your API key in the browser), then render a
        button that opens it:
      </p>
      <DocsCodeBlock
        code={`import { PayButton } from "@loofta/pay-sdk/react"; // or copy components/sdk/PayButton.tsx

<PayButton
  checkoutUrl={link.url}
  buttonText={\`Pay $\${link.amount}\`}
  onSuccess={(paymentId) => console.log("Paid:", paymentId)}
/>`}
      />

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
