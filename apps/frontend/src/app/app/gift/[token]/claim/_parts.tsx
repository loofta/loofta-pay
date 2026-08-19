'use client';

// Small presentational pieces for the gift claim page's recipient/sender cards — page-scoped
// (not a globally shared module) since GiftShareClient.tsx intentionally stays visually simpler.
import { Check } from 'lucide-react';

/** Outer ticket-card chrome (gradient top edge + rounded border) shared by every state — only
 *  the inner content differs per branch on the page. */
export function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-white/[0.09] bg-gradient-to-b from-[#17171c] to-[#101014] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]">
      <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#FF1301] to-[#EAB308]" />
      {children}
    </div>
  );
}

export function Avatar({ label }: { label: string }) {
  const initial = label.replace(/^@/, '').charAt(0).toUpperCase() || '?';
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF1301] to-[#EAB308] font-display text-base font-semibold text-white">
      {initial}
    </div>
  );
}

export function Chip({ tone = 'plain', children }: { tone?: 'plain' | 'ok' | 'wait'; children: React.ReactNode }) {
  const toneClass = tone === 'ok'
    ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400'
    : tone === 'wait'
      ? 'border-amber-500/30 bg-amber-500/[0.08] text-amber-400'
      : 'border-white/10 bg-white/[0.04] text-slate-300';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

/** Dashed divider mimicking a real ticket stub's tear line. */
export function Perforation() {
  return <div className="mx-5 border-t border-dashed border-white/[0.14]" />;
}

export function StepRow({ state, title, sub }: { state: 'done' | 'now' | 'todo'; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          state === 'done'
            ? 'border-emerald-400 bg-emerald-400/15'
            : state === 'now'
              ? 'animate-spin border-amber-400 border-t-transparent'
              : 'border-white/15'
        }`}
      >
        {state === 'done' && <Check className="h-3 w-3 text-emerald-400" strokeWidth={3} />}
      </div>
      <div className={`text-base leading-snug ${state === 'todo' ? 'text-slate-500' : 'text-white'}`}>
        {title}
        <div className="mt-0.5 text-sm text-slate-500">{sub}</div>
      </div>
    </div>
  );
}

/** Pre-claim "?" grid, or a shimmering version while the ticket is being minted — real numbers
 *  use TicketNumberCard instead (apps/frontend/src/components/megapot/TicketNumberCard.tsx),
 *  same component the rest of the app already uses once numbers actually exist. */
export function NumberPlaceholderGrid({ shimmer = false }: { shimmer?: boolean }) {
  const cellClass = (extra: string) =>
    `flex aspect-square flex-1 items-center justify-center rounded-xl border font-display text-lg font-semibold ${
      shimmer ? 'animate-pulse text-transparent' : ''
    } ${extra}`;
  return (
    <div className="flex gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={cellClass(shimmer ? 'border-white/10 bg-white/[0.08]' : 'border-white/10 bg-white/[0.03] text-slate-600')}>
          {shimmer ? '' : '?'}
        </div>
      ))}
      <div className={cellClass(shimmer ? 'border-amber-500/30 bg-amber-500/[0.12]' : 'border-amber-500/30 bg-amber-500/[0.06] text-amber-400/60')}>
        {shimmer ? '' : '?'}
      </div>
    </div>
  );
}
