'use client';
// CardAttributesPanel.tsx — the grading/set/serial stat readout next to a revealed GachaCard.
// Leads with the card's name and its single most important stat (grade, if it's a graded card)
// always visible — everything else is collapsed behind a "show more" toggle rather than dumping
// the full attribute list at once. Expanding still reveals those extra lines one at a time
// (video-game stat-screen style) instead of all appearing together.

import { useEffect, useMemo, useState } from 'react';
import type { GachaNftAttribute } from './GachaPack3D';

// Collector Crypt's raw attribute list includes several internal/redundant fields (hex ids,
// duplicate description text, a URL) that don't read well as a stat line — dropped here rather
// than in the backend mapping, which passes the full list through unfiltered on purpose (see
// NftMetadata.attributes) so nothing is lost if a future UI wants them.
const HIDDEN_TRAIT_TYPES = new Set([
  'Gemrate Id', 'Gemrate Universal Id', 'Spec Id', 'Vault ID', 'Grading ID', 'Set Url', 'Description', 'Location',
]);

function attr(attributes: GachaNftAttribute[] | undefined, traitType: string): string | undefined {
  return attributes?.find((a) => a?.trait_type === traitType)?.value || undefined;
}

export default function CardAttributesPanel({
  name,
  attributes,
  insuredValueUsdc,
  rarity,
  lineDelayMs = 110,
  className,
}: {
  name?: string;
  attributes?: GachaNftAttribute[];
  insuredValueUsdc?: number;
  rarity?: string;
  lineDelayMs?: number;
  className?: string;
}) {
  // The single headline stat: a graded card's grade is the one number everyone actually cares
  // about first, so it leads whenever the API gave us one — everything else is secondary detail.
  const grade = attr(attributes, 'The Grade');
  const gradingCompany = attr(attributes, 'Grading Company');
  const headline = useMemo(() => {
    if (grade) return { label: 'Grade', value: gradingCompany ? `${gradingCompany} ${grade}` : grade };
    if (rarity) return { label: 'Rarity', value: rarity.charAt(0).toUpperCase() + rarity.slice(1) };
    if (insuredValueUsdc) return { label: 'Insured Value', value: `$${insuredValueUsdc.toFixed(2)}` };
    return null;
  }, [grade, gradingCompany, rarity, insuredValueUsdc]);

  const moreLines = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    if (rarity && headline?.label !== 'Rarity') rows.push({ label: 'Rarity', value: rarity.charAt(0).toUpperCase() + rarity.slice(1) });
    for (const a of attributes ?? []) {
      if (!a?.trait_type || !a?.value || HIDDEN_TRAIT_TYPES.has(a.trait_type)) continue;
      if (a.trait_type === 'The Grade' || a.trait_type === 'Grading Company') continue; // already in the headline
      rows.push({ label: a.trait_type, value: String(a.value) });
    }
    if (insuredValueUsdc && headline?.label !== 'Insured Value') rows.push({ label: 'Insured Value', value: `$${insuredValueUsdc.toFixed(2)}` });
    return rows;
  }, [attributes, insuredValueUsdc, rarity, headline]);

  const [expanded, setExpanded] = useState(false);
  // Keyed off a fingerprint of the actual content, not just .length — swapping to a
  // same-length-different-card result should still restart the reveal from the top.
  const fingerprint = moreLines.map((l) => l.label + l.value).join('|');
  const [shown, setShown] = useState(0);
  useEffect(() => { setExpanded(false); setShown(0); }, [fingerprint]);
  useEffect(() => {
    if (!expanded || !moreLines.length) return;
    const id = setInterval(() => {
      setShown((n) => {
        if (n + 1 >= moreLines.length) { clearInterval(id); return moreLines.length; }
        return n + 1;
      });
    }, lineDelayMs);
    return () => clearInterval(id);
  }, [expanded, moreLines.length, lineDelayMs]);

  if (!name && !headline && !moreLines.length) return null;

  return (
    <div className={`w-full max-w-xs ${className ?? ''}`}>
      {name && <p className="text-slate-100 text-lg font-semibold leading-snug mb-1.5">{name}</p>}
      {headline && (
        <div className="flex items-baseline justify-between gap-3 border-b border-white/10 py-1.5 font-mono text-sm">
          <span className="text-slate-500 uppercase tracking-wide text-xs shrink-0">{headline.label}</span>
          <span className="text-amber-300 font-semibold text-right truncate">{headline.value}</span>
        </div>
      )}

      {expanded && (
        // 2 columns, not a single stacked list — this panel sits next to (or under) a fixed-width
        // card on mobile, and a graded Collector Crypt scan can carry a dozen+ attributes; one
        // column of full-width rows ran taller than the viewport, two halves that height.
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-sm">
          {moreLines.slice(0, shown).map((l, i) => (
            <div key={l.label + i} className="min-w-0 border-b border-white/5 py-1.5 animate-stat-line-in">
              <div className="text-slate-500 uppercase tracking-wide text-xs truncate">{l.label}</div>
              <div className="text-slate-100 truncate">{l.value}</div>
            </div>
          ))}
        </div>
      )}

      {moreLines.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 text-sm text-slate-400 hover:text-slate-200 transition-colors underline underline-offset-2"
        >
          {expanded ? 'Show less' : `Show ${moreLines.length} more detail${moreLines.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
