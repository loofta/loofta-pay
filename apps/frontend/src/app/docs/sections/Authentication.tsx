import Link from "next/link";
import { DocsCodeBlock } from "../DocsCodeBlock";

export function Authentication() {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Authentication</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Every request is authenticated with a bearer API key, scoped to your own account — a key
        can only ever create payment links that pay <em>you</em>.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">1. Generate a key</h2>
      <p className="text-base text-slate-400 mb-3">
        Log into Loofta and open <Link href="/app/developer" className="text-orange-400 hover:underline">Developer settings</Link>.
        Click "Generate API key" — the raw key is shown once. Store it somewhere safe; Loofta only
        ever stores a salted hash of it.
      </p>
      <p className="text-base text-slate-400 mb-6">
        Keys are devnet-only for now. Mainnet access is a manual upgrade — reach out if you need it.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">2. Send it as a bearer token</h2>
      <DocsCodeBlock code={`Authorization: Bearer lft_test_...`} />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Rotating and revoking</h2>
      <p className="text-base text-slate-400 mb-2">
        "Generate another" on the Developer page mints an additional key without invalidating the
        old one — rotate on your own schedule, then revoke the old key once you've switched over.
        Revoked keys stop working immediately.
      </p>
    </article>
  );
}
