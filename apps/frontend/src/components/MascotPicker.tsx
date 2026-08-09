"use client";

// Mascot lock-in — ported 1:1 from pack-party/preview/pack-party-screens.jsx's ScreenPick
// ("PICK YOUR FIGHTER"): pick from the grid, see your pick big (in its "happy" mood) in the
// sticky preview panel, then explicitly commit with "Lock In". Deliberately a separate two-step
// (pick -> confirm) flow: once locked, the choice is permanent for the room (see
// gacha.service.ts lockMascot), so a stray tap shouldn't be able to lock the wrong one in.

import { useCallback, useEffect, useRef, useState } from "react";
import { MASCOTS } from "@/lib/mascots";
import Mascot from "@/components/Mascot";
import { Shell } from "@/components/PackParty";

const PICK_SECONDS = 30;

export default function MascotPicker({
  lockedMascotKey,
  onLock,
}: {
  /** Already-locked mascot key for this seat, if any — renders the read-only "locked in" state. */
  lockedMascotKey: string | null;
  onLock: (mascotKey: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(PICK_SECONDS);
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  // Guards against firing twice: lockedMascotKey only updates once the parent's refresh() round
  // trip completes after a successful lock, so without this the auto-lock effect below would see
  // secondsLeft still 0 and locking already back to false in that gap and fire again.
  const autoLockedRef = useRef(false);

  const lockKey = useCallback(async (mascotKey: string) => {
    setLocking(true);
    setError(null);
    const res = await onLock(mascotKey);
    if (!res.ok) setError(res.error ?? "Couldn't lock that in — please try again.");
    setLocking(false);
  }, [onLock]);

  // 30s to pick — if you haven't locked one in by then, you get a random one so a distracted
  // player can never stall the whole room from advancing to the exclusion draw.
  useEffect(() => {
    if (lockedMascotKey) return;
    const interval = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(interval);
  }, [lockedMascotKey]);

  useEffect(() => {
    if (lockedMascotKey || secondsLeft > 0 || locking || autoLockedRef.current) return;
    autoLockedRef.current = true;
    const fallback = selectedRef.current ?? MASCOTS[Math.floor(Math.random() * MASCOTS.length)].key;
    void lockKey(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lockKey/locking would re-run this every render
  }, [secondsLeft, lockedMascotKey]);

  if (lockedMascotKey) {
    const mascot = MASCOTS.find((m) => m.key === lockedMascotKey);
    return (
      <Shell kicker="1 / 6 · PICK" title="LOCKED" titleGrad="IN" sub="waiting on everyone else to lock in too…">
        <aside className="pp-preview" style={{ position: "static" }}>
          {mascot && <Mascot key={mascot.key} name={mascot.key} mood="happy" size={230} />}
          <div className="pp-preview-name">{mascot?.name ?? lockedMascotKey}</div>
          <div className="pp-preview-sub">ready to feast</div>
        </aside>
      </Shell>
    );
  }

  const previewMascot = MASCOTS.find((m) => m.key === selected);

  return (
    <Shell
      kicker={<span className={secondsLeft <= 10 ? "text-red-300" : undefined}>1 / 6 · PICK · 0:{secondsLeft.toString().padStart(2, "0")}</span>}
      title="PICK YOUR"
      titleGrad="FIGHTER"
      sub="this dork represents you in the room"
    >
      {error && <p className="text-red-300 text-base mb-4">{error}</p>}
      <div className="pp-picklayout">
        <div className="pp-pickgrid">
          {MASCOTS.map((m) => {
            const isSel = selected === m.key;
            return (
              <button
                key={m.key}
                type="button"
                className={"pp-pick" + (isSel ? " sel" : "")}
                // Inline style on top of the .sel class — belt and suspenders. If the .sel rule
                // ever loses a specificity/load-order fight against some other stylesheet, an
                // inline style still wins, so "I clicked one and nothing visibly changed" can
                // never happen purely from a CSS cascade issue.
                style={isSel ? { position: "relative", background: "rgba(234,179,8,0.22)", borderColor: "#EAB308", boxShadow: "0 0 0 2px #EAB308, 0 0 18px rgba(234,179,8,0.45)" } : { position: "relative" }}
                onClick={() => setSelected(m.key)}
              >
                {isSel && (
                  <span
                    aria-hidden
                    style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 999, background: "#EAB308", color: "#0B0B0F", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    ✓
                  </span>
                )}
                <Mascot name={m.key} mood="idle" size={80} />
                <span>{m.name}</span>
              </button>
            );
          })}
        </div>
        <aside className="pp-preview">
          {previewMascot ? (
            <Mascot key={previewMascot.key} name={previewMascot.key} mood="happy" size={230} />
          ) : (
            <div style={{ width: 230, height: 230 }} />
          )}
          <div className="pp-preview-name">{previewMascot?.name ?? "choose one"}</div>
          <div className="pp-preview-sub">ready to feast</div>
          <button type="button" className="pp-btn gold" disabled={!selected || locking} onClick={() => selected && lockKey(selected)}>
            {locking ? "LOCKING IN…" : "LOCK IN →"}
          </button>
        </aside>
      </div>
    </Shell>
  );
}
