import Link from "next/link";

export function Intro({ onNavigate }: { onNavigate: (slug: string) => void }) {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Loofta Pay API</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Create payment links programmatically, and get paid by anyone — no Loofta account required
        on their end. They pay as a guest with any token on any chain, or with an existing Loofta
        balance if they have one, and you receive the exact amount. No webhook plumbing required to
        get started.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">How it works</h2>
      <ol className="list-decimal list-inside space-y-2 text-base text-slate-300 mb-6">
        <li>Generate an API key from your <Link href="/app/developer" className="text-orange-400 hover:underline">Developer settings</Link>.</li>
        <li>Call <code className="text-orange-300">POST /payment-links</code> with an amount and a message — fresh, per order.</li>
        <li>Share the returned checkout URL — a minimal, unbranded payment page.</li>
        <li>The payer pays, no account needed. You always receive the exact amount; fees are on them.</li>
      </ol>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Base URL</h2>
      <p className="text-base text-slate-400 mb-6">
        <code className="text-orange-300">https://api.loofta.xyz</code>
      </p>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-slate-300 text-base">
          Next:{" "}
          <button type="button" onClick={() => onNavigate("authentication")} className="text-orange-400 hover:underline">
            set up authentication
          </button>{" "}
          or jump straight to{" "}
          <button type="button" onClick={() => onNavigate("code-examples")} className="text-orange-400 hover:underline">
            code examples
          </button>.
        </p>
      </div>
    </article>
  );
}
