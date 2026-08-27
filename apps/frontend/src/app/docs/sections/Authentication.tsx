import { DocsCodeBlock } from "../DocsCodeBlock";

export function Authentication({ onNavigate }: { onNavigate: (slug: string) => void }) {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Authentication</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Every request is authenticated with a bearer API key, scoped to your own account — a key
        can only ever create payment links that pay <em>you</em>.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">1. Generate a key</h2>
      <p className="text-base text-slate-400 mb-3">
        Log into Loofta and open{" "}
        <button type="button" onClick={() => onNavigate("api-key")} className="text-orange-400 hover:underline">
          API key &amp; branding
        </button>.
        Click "Generate API key" — the raw key is shown once. Store it somewhere safe; Loofta only
        ever stores a salted hash of it.
      </p>
      <p className="text-base text-slate-400 mb-6">
        Keys are live (mainnet) — payments made through them move real money. There is no sandbox
        mode yet; test with small real amounts.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">2. Send it as a bearer token</h2>
      <DocsCodeBlock code={`Authorization: Bearer lft_live_...`} />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Generating vs. rotating</h2>
      <p className="text-base text-slate-400 mb-2">
        These are opposites, so pick deliberately:
      </p>
      <ul className="list-disc list-inside space-y-2 text-base text-slate-300 mb-2">
        <li><strong className="text-slate-100">Generate</strong> — revokes your existing key and mints a fresh one in its place. Use this if a key may have leaked, or you just want a clean slate.</li>
        <li><strong className="text-slate-100">Rotate</strong> — mints an additional key without touching the old one, so you can switch your deployed code over on your own schedule before manually revoking the old key. Use this for a zero-downtime swap.</li>
      </ul>
      <p className="text-base text-slate-400 mb-6">
        Revoked keys stop working immediately. The raw key value is only ever shown once, at
        creation — Loofta stores just a salted hash of it.
      </p>
    </article>
  );
}
