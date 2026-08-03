'use client';
// CardAttributesPanel.tsx — the grading/set/serial stat list next to a revealed GachaCard.
// Lines reveal one at a time on an interval (video-game stat-screen style) instead of all
// appearing at once — matches the "one by one line" reveal pace the card itself already has.

import { useEffect, useMemo, useState } from 'react';
import type { GachaNftAttribute } from './GachaPack3D';

// Collector Crypt's raw attribute list includes several internal/redundant fields (hex ids,
// duplicate description text, a URL) that don't read well as a stat line — dropped here rather
// than in the backend mapping, which passes the full list through unfiltered on purpose (see
// NftMetadata.attributes) so nothing is lost if a future UI wants them.
const HIDDEN_TRAIT_TYPES = new Set([
  'Gemrate Id', 'Spec Id', 'Vault ID', 'Grading ID', 'Set Url', 'Description', 'Location',
]);

export default function CardAttributesPanel({
  attributes,
  insuredValueUsdc,
  rarity,
  lineDelayMs = 110,
  className,
}: {
  attributes?: GachaNftAttribute[];
  insuredValueUsdc?: number;
  rarity?: string;
  lineDelayMs?: number;
  className?: string;
}) {
  const lines = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    if (rarity) rows.push({ label: 'Rarity', value: rarity.charAt(0).toUpperCase() + rarity.slice(1) });
    for (const a of attributes ?? []) {
      if (!a?.trait_type || !a?.value || HIDDEN_TRAIT_TYPES.has(a.trait_type)) continue;
      rows.push({ label: a.trait_type, value: String(a.value) });
    }
    if (insuredValueUsdc) rows.push({ label: 'Insured Value', value: `$${insuredValueUsdc.toFixed(2)}` });
    return rows;
  }, [attributes, insuredValueUsdc, rarity]);

  // Keyed off a fingerprint of the actual content, not just .length — swapping to a
  // same-length-different-card result (e.g. two cards in a row with 8 attributes each) should
  // still restart the reveal from the top rather than silently keeping the old line count.
  const fingerprint = lines.map((l) => l.label + l.value).join('|');
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (!lines.length) return;
    const id = setInterval(() => {
      setShown((n) => {
        if (n + 1 >= lines.length) { clearInterval(id); return lines.length; }
        return n + 1;
      });
    }, lineDelayMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, lineDelayMs]);

  if (!lines.length) return null;

  return (
    <div className={`w-full max-w-xs font-mono text-sm ${className ?? ''}`}>
      {lines.slice(0, shown).map((l, i) => (
        <div
          key={l.label + i}
          className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 animate-stat-line-in"
        >
          <span className="text-slate-500 uppercase tracking-wide text-xs shrink-0">{l.label}</span>
          <span className="text-slate-100 text-right truncate">{l.value}</span>
        </div>
      ))}
    </div>
  );
}
