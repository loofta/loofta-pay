"use client";

// Shared custom-number picker UI — extracted from megapot/page.tsx's Buy tab so the ticket
// subscription flow (subscribe/page.tsx) can offer the exact same picking experience (shuffle,
// per-ticket edit, random) instead of a second, drifting copy of this UI.

import { useState } from "react";
import { Shuffle, Eraser, X, MoreVertical, Plus } from "lucide-react";

export const MAIN_MAX = 30;
export const MAIN_COUNT = 5;
export const BONUS_MAX = 10;

export interface TicketNumbers { main: number[]; bonus: number }

export function randomTicket(): TicketNumbers {
  const s = new Set<number>();
  while (s.size < MAIN_COUNT) s.add(Math.ceil(Math.random() * MAIN_MAX));
  return { main: [...s].sort((a, b) => a - b), bonus: Math.ceil(Math.random() * BONUS_MAX) };
}

// ─── Number Picker Modal ──────────────────────────────────────────────────────

export function NumberPickerModal({ ticket, onSave, onClose }: {
  ticket: TicketNumbers;
  onSave: (t: TicketNumbers) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TicketNumbers>({ main: [...ticket.main], bonus: ticket.bonus });

  function toggleMain(n: number) {
    setDraft(d => {
      if (d.main.includes(n)) return { ...d, main: d.main.filter(x => x !== n) };
      if (d.main.length >= MAIN_COUNT) {
        // swap last picked for the new number
        return { ...d, main: [...d.main.slice(0, -1), n].sort((a, b) => a - b) };
      }
      return { ...d, main: [...d.main, n].sort((a, b) => a - b) };
    });
  }

  function toggleBonus(n: number) {
    setDraft(d => ({ ...d, bonus: d.bonus === n ? 0 : n }));
  }

  const isComplete = draft.main.length === MAIN_COUNT && draft.bonus > 0;

  const mainRemaining = MAIN_COUNT - draft.main.length;
  const saveLabel = !isComplete
    ? [mainRemaining > 0 && `${mainRemaining} main`, draft.bonus === 0 && "bonus"].filter(Boolean).join(" + ") + " left"
    : "Save numbers";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-[#1a1a22] rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h3 className="text-white font-bold text-lg leading-tight">Pick your numbers</h3>
            <p className="text-base text-slate-500 mt-0.5">
              {draft.main.length}/{MAIN_COUNT} main · {draft.bonus > 0 ? 1 : 0}/1 bonus
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setDraft(randomTicket())}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-300 bg-white/[0.06] hover:bg-white/[0.10] transition-colors">
              <Shuffle className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setDraft({ main: [], bonus: 0 })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-300 bg-white/[0.06] hover:bg-white/[0.10] transition-colors">
              <Eraser className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-3 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Main numbers 1–30 */}
          <div>
            <p className="text-base font-medium text-slate-500 mb-2">Main numbers — pick 5</p>
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: MAIN_MAX }, (_, i) => i + 1).map(n => {
                const selected = draft.main.includes(n);
                const willSwap = !selected && draft.main.length >= MAIN_COUNT;
                return (
                  <button key={n} onClick={() => toggleMain(n)}
                    className={[
                      "h-10 w-10 rounded-full text-sm font-semibold transition-all duration-150",
                      selected
                        ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] text-white shadow-[0_4px_12px_rgba(255,122,42,0.35)]"
                        : willSwap
                          ? "bg-white/[0.05] text-slate-500 hover:bg-white/[0.10] hover:text-slate-300"
                          : "bg-white/[0.07] text-slate-300 hover:bg-white/[0.12]",
                    ].join(" ")}>
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bonus 1–BONUS_MAX */}
          <div>
            <p className="text-base font-medium text-slate-500 mb-2">Bonus number — pick 1</p>
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: BONUS_MAX }, (_, i) => i + 1).map(n => (
                <button key={n} onClick={() => toggleBonus(n)}
                  className={[
                    "h-10 w-10 rounded-full text-sm font-semibold transition-all duration-150",
                    draft.bonus === n
                      ? "bg-white text-[#0f0f12] shadow-[0_4px_12px_rgba(255,255,255,0.2)]"
                      : "bg-white/[0.07] text-slate-300 hover:bg-white/[0.12]",
                  ].join(" ")}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="px-5 pb-6 pt-3 border-t border-white/[0.06] space-y-2">
          <button onClick={() => { onSave(draft); onClose(); }} disabled={!isComplete}
            className="w-full h-13 py-3.5 rounded-xl font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
            {saveLabel}
          </button>
          <button onClick={onClose}
            className="w-full py-2.5 text-base text-slate-500 hover:text-slate-300 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Choose numbers ───────────────────────────────────────────────────────────

export function ChooseNumbers({ tickets, setTickets, hideCountControls }: {
  tickets: TicketNumbers[];
  setTickets: (t: TicketNumbers[]) => void;
  /** Hides "Add ticket" and the per-row "Remove" option — for a context where the ticket COUNT
   *  is fixed by something else (e.g. the subscription's tickets-per-day cadence picker) and this
   *  component should only ever let the numbers themselves be edited/shuffled. */
  hideCountControls?: boolean;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [menuOpenIdx, setMenuOpenIdx] = useState<number | null>(null);

  function updateTicket(idx: number, t: TicketNumbers) {
    setTickets(tickets.map((tt, i) => i === idx ? t : tt));
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setTickets(tickets.map(() => randomTicket()))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-base font-medium bg-white/[0.05] border border-white/10 text-slate-300 hover:bg-white/[0.09] hover:text-white transition-colors">
          <Shuffle className="w-3.5 h-3.5" /> Shuffle all
        </button>
        <div className="flex-1" />
      </div>

      {/* Ticket rows */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] divide-y divide-white/[0.06]">
        {tickets.map((t, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2.5 group">
            {/* Number bubbles — click row to open picker */}
            <button type="button" onClick={() => setEditingIdx(i)}
              className="flex items-center gap-1.5 flex-1 min-w-0">
              {t.main.map((n, pos) => (
                <span key={pos}
                  className="w-8 h-8 rounded-full bg-white/[0.08] border border-white/[0.08] text-slate-200 text-sm font-semibold flex items-center justify-center shrink-0">
                  {n}
                </span>
              ))}
              {t.bonus > 0 && (
                <>
                  <span className="w-px h-4 bg-white/10 mx-0.5 shrink-0" />
                  <span className="w-8 h-8 rounded-full bg-white/80 text-[#0f0f12] text-sm font-bold flex items-center justify-center shrink-0 shadow-sm">
                    {t.bonus}
                  </span>
                </>
              )}
            </button>

            {/* Row menu */}
            <div className="relative shrink-0">
              <button type="button" onClick={() => setMenuOpenIdx(menuOpenIdx === i ? null : i)}
                className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 transition-colors">
                <MoreVertical className="w-4 h-4" />
              </button>
              {menuOpenIdx === i && (
                <div className="absolute right-0 top-8 z-30 w-36 rounded-xl bg-[#1a1a22] border border-white/10 shadow-xl py-1">
                  <button type="button" onClick={() => { setEditingIdx(i); setMenuOpenIdx(null); }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
                    Edit numbers
                  </button>
                  <button type="button" onClick={() => { updateTicket(i, randomTicket()); setMenuOpenIdx(null); }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
                    Shuffle
                  </button>
                  {!hideCountControls && tickets.length > 1 && (
                    <button type="button" onClick={() => { setTickets(tickets.filter((_, ti) => ti !== i)); setMenuOpenIdx(null); }}
                      className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add ticket */}
      {!hideCountControls && (
        <button type="button" onClick={() => setTickets([...tickets, randomTicket()])}
          className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl text-base font-medium text-slate-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] transition-all w-full justify-center">
          <Plus className="w-4 h-4" /> Add ticket
        </button>
      )}

      <p className="text-sm text-slate-600 text-center mt-2">
        Tap any row to edit numbers
      </p>

      {/* Number picker modal */}
      {editingIdx !== null && (
        <NumberPickerModal
          ticket={tickets[editingIdx]}
          onSave={t => updateTicket(editingIdx, t)}
          onClose={() => setEditingIdx(null)}
        />
      )}
    </>
  );
}
