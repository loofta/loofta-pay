export function CheckoutPage() {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">The checkout page</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        The URL returned by <code className="text-orange-300">POST /payment-links</code> is a
        minimal, unbranded page — no Loofta navigation, just the pay card and a small "Powered by
        Loofta" badge. It's meant to be linked to or embedded directly, Stripe Checkout–style.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">What the payer does</h2>
      <ol className="list-decimal list-inside space-y-2 text-base text-slate-300 mb-6">
        <li>Opens the link and logs in with Loofta (email, X, Discord, or GitHub).</li>
        <li>If they already have a Loofta balance, they pay with one tap.</li>
        <li>If not, they fund the payment — card, bank transfer, Coinbase, or any token — and pay.</li>
      </ol>
      <p className="text-base text-slate-400 mb-6">
        Logging in on a checkout page never shows Loofta's own onboarding — no username prompts,
        no product tour. A wallet and a username are created for them automatically in the
        background so paying is never blocked on that.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Every payment is private</h2>
      <p className="text-base text-slate-400 mb-6">
        Links created via the API are private by default — the amount and counterparty aren't a
        public on-chain record. The payer's total already includes that fee; you still receive
        exactly the amount you set.
      </p>
    </article>
  );
}
