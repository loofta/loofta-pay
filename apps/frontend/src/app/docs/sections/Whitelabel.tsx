import { ClaimPagePreview } from "./ClaimPagePreview";

const CONTACT_HREF = "mailto:hello@loofta.xyz?subject=" + encodeURIComponent("Whitelabel the claim page");
const TELEGRAM_HREF = "https://t.me/looftaxyz";

export function Whitelabel({ onNavigate }: { onNavigate: (slug: string) => void }) {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Whitelabel the claim page</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Every{" "}
        <button type="button" onClick={() => onNavigate("send-payments")} className="text-orange-400 hover:underline">
          payout
        </button>{" "}
        you send generates a <code className="text-orange-300">claim_link</code> at{" "}
        <code className="text-orange-300">pay.loofta.com/c/:id</code>. That&apos;s where your
        recipient actually shows up to collect their money. By default it&apos;s a Loofta page:
        Loofta branding, Loofta domain. For most integrations that&apos;s fine. If your recipients
        should never see the word &quot;Loofta&quot;, that page can be whitelabeled instead. Here&apos;s
        the difference:
      </p>

      <ClaimPagePreview />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Full whitelabel is on-demand</h2>
      <p className="text-base text-slate-400 mb-4">
        Putting the claim experience on your own domain, with your own branding and no Loofta name
        anywhere in it, isn&apos;t a flag you flip yourself. It&apos;s set up on-demand by the
        Loofta team, per integrator. That&apos;s deliberate: claim pages move real money, so each
        one gets configured and verified by hand instead of opened up as a self-serve API.
      </p>
      <p className="text-base text-slate-400 mb-6">
        <a href={TELEGRAM_HREF} target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:underline">
          Message us on Telegram
        </a>{" "}
        or{" "}
        <a href={CONTACT_HREF} className="text-orange-400 hover:underline">
          email us
        </a>{" "}
        with the domain you want to use and the volume you&apos;re expecting, and we&apos;ll set it
        up with you.
      </p>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-slate-300 text-base">
          Not ready for a full whitelabel? Recipients still see your{" "}
          <span className="text-orange-300 font-medium">message</span> on the payout, and
          everything else about{" "}
          <button type="button" onClick={() => onNavigate("send-payments")} className="text-orange-400 hover:underline">
            sending a payout
          </button>{" "}
          works the same either way.
        </p>
      </div>
    </article>
  );
}
