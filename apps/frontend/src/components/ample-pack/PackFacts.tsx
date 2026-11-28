/** The whole offer, in three lines. */
export const PACK_FACTS = ["Bonus tickets worth $10 to $150.", "Unlocked with a deposit of at least $10.", "One pack per user."];

export function PackFacts({ className = "text-base text-white/90" }: { className?: string }) {
  return (
    <p className={className}>
      {PACK_FACTS.map((f) => <span key={f} className="block">{f}</span>)}
    </p>
  );
}
