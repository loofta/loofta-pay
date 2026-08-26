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
      <p className="text-base text-slate-400 mb-3">
        No Loofta account required — checkout defaults to a guest flow:
      </p>
      <ol className="list-decimal list-inside space-y-2 text-base text-slate-300 mb-6">
        <li>Opens the link, enters an email (used for a receipt — no verification, no account created).</li>
        <li>Picks a payment method: USDC on Solana from a connected wallet, or any token on any
          chain via a cross-chain bridge.</li>
        <li>Pays. Nothing to sign up for, nothing to confirm afterward.</li>
      </ol>
      <p className="text-base text-slate-400 mb-6">
        If they already have a Loofta account, they can sign in on the same page instead and pay
        with their existing balance in one tap — but that's an option, never a requirement.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Public by default, private on request</h2>
      <p className="text-base text-slate-400 mb-6">
        Links created via the API are public by default — no privacy fee, you still receive exactly
        the <code>amount</code> you set. Pass <code>is_private: true</code> at creation to require
        the payer to pay privately instead (the amount and counterparty aren't a public on-chain
        record); the payer's total already includes that fee either way.
      </p>
    </article>
  );
}
