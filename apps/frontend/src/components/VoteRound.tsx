"use client";

// "CUT ONE MORE?" — ported 1:1 from pack-party/preview/pack-party-screens.jsx's ScreenVote.
// Survivors vote each round on whether to knock out one more random survivor for a bigger split.
// Majority YES (ties count as YES) cuts one more via a fresh on-chain VRF draw; NO, or getting
// down to 1 survivor, ends voting and settles. See gacha.service.ts (castVote/
// checkVoteRoundComplete) for the real rules this mirrors — the reference has no on-chain draw
// behind its cut, so `drawInProgress` (shown as a plain "drawing…" beat) is this app's own
// addition, not something to skip.

import { useEffect, useState } from "react";
import { Shell, Chip, type ChipPlayer } from "@/components/PackParty";
import { getMascot } from "@/lib/mascots";

export interface VoteParticipant {
  seatNumber: number;
  username: string | null;
  isMe: boolean;
  mascotKey: string | null;
}

export default function VoteRound({
  round,
  survivors,
  potUsdc,
  myVote,
  onVote,
  drawInProgress,
}: {
  round: number;
  survivors: VoteParticipant[];
  potUsdc: number;
  /** undefined = haven't voted yet this round (resets to undefined whenever `round` changes). */
  myVote: boolean | undefined;
  onVote: (vote: boolean) => void;
  /** True once this round has passed and a fresh VRF draw is picking who gets cut. */
  drawInProgress: boolean;
}) {
  const [voting, setVoting] = useState(true);
  useEffect(() => { setVoting(true); }, [round]);

  const shareNow = survivors.length ? potUsdc / survivors.length : 0;
  const shareIfCut = survivors.length > 1 ? potUsdc / (survivors.length - 1) : shareNow;
  const iAmSurvivor = survivors.some((p) => p.isMe);

  const chipPlayers: ChipPlayer[] = survivors.map((p) => ({
    seatNumber: p.seatNumber,
    mascotKey: p.mascotKey,
    name: getMascot(p.mascotKey)?.name ?? p.username ?? `Seat ${p.seatNumber}`,
    isMe: p.isMe,
  }));

  const footer = !drawInProgress && (
    iAmSurvivor ? (
      myVote === undefined ? (
        <div className="pp-votebtns">
          <button type="button" className="pp-btn" onClick={() => { onVote(true); setVoting(false); }}>
            YES, CUT 🔪
          </button>
          <button type="button" className="pp-btn ghost" onClick={() => { onVote(false); setVoting(false); }}>
            NO, LOCK IT IN
          </button>
        </div>
      ) : (
        <p className="pp-small" style={{ marginTop: 0 }}>you voted {myVote ? "YES" : "NO"} — waiting on the room…</p>
      )
    ) : (
      <p className="pp-small" style={{ marginTop: 0 }}>you're out — watching the survivors decide</p>
    )
  );

  return (
    <Shell
      kicker={`5 / 6 · VOTE · ROUND ${round}`}
      title="CUT ONE"
      titleGrad="MORE?"
      sub="majority YES (ties count as YES) cuts one more random survivor. fewer mouths, fatter share."
      footer={footer}
    >
      {drawInProgress ? (
        <p className="pp-btn waitpulse" style={{ background: "none", boxShadow: "none", color: "#FFE9A8" }}>
          Drawing who gets cut…
        </p>
      ) : (
        <>
          <div className="pp-voterow">
            {chipPlayers.map((p) => (
              <Chip key={p.seatNumber} p={p} mood={voting ? "idle" : "happy"} size={84} tag={p.isMe ? (myVote === undefined ? "…" : myVote ? "YES" : "NO") : "…"} />
            ))}
          </div>
          <div className="pp-mathrow">
            <div className="pp-math">
              <span>share now</span>
              <b>${shareNow.toFixed(2)}</b>
            </div>
            <div className="pp-math hot">
              <span>if one gets cut</span>
              <b style={{ background: "linear-gradient(90deg,#FF1301,#FF6A00,#EAB308)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>${shareIfCut.toFixed(2)}</b>
            </div>
          </div>
          {voting && <p className="pp-small">30s to vote, or it's a NO for you.</p>}
        </>
      )}
    </Shell>
  );
}
