import { VenetianMask } from "lucide-react";

/** Loofta's private-payment glyph — used anywhere a payment's privacy needs a visual tell
 *  (claim page, history rows, confetti bursts) instead of a generic lock icon. Deliberately
 *  muted: no fill color, no glow. The previous ghost mascot drew exactly the kind of attention
 *  a "private" payment shouldn't — got flagged as a privacy red flag in user feedback. */
export function PrivacyGlyph({ size, opacity, className }: { size: number; opacity: number; className?: string }) {
  return <VenetianMask size={size} strokeWidth={1.75} style={{ opacity }} className={className} />;
}
