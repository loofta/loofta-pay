"use client";

// Gacha demo — pure UI walkthrough, zero backend calls. Simulates the real flow entirely in
// local state with timers, reusing the exact same screens as the real /app/gacha/play +
// /app/gacha/[roomId] pages (MascotPicker, Shell/Chip, GachaPack3D, GachaRoulette, VoteRound —
// all ported 1:1 from pack-party/preview/pack-party-screens.jsx), so this stays a genuinely
// accurate preview of the product without a wallet, a database, or any real money moving.
// Nothing here ever touches /api/gacha/* — see those two real pages for the versions wired to
// the backend.

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import MascotPicker from "@/components/MascotPicker";
import GachaRoulette from "@/components/GachaRoulette";
import VoteRound, { type VoteParticipant } from "@/components/VoteRound";
import Mascot from "@/components/Mascot";
import { Shell, Chip, money, type ChipPlayer } from "@/components/PackParty";
import { MASCOTS, getMascot } from "@/lib/mascots";
import type { GachaOpenResult, GachaRarity } from "@/components/GachaPack3D";

const GachaPack3D = dynamic(() => import("@/components/GachaPack3D"), { ssr: false });

type DemoStage = "pick" | "lobby" | "rip" | "excluding" | "voting" | "settled";

interface DemoPlayer {
  seatNumber: number;
  mascotKey: string;
  isMe: boolean;
  excluded: boolean;
}

const ENTRY_USDC = 10;
const RARITIES: Array<{ rarity: GachaRarity; buybackUsdc: number; name: string }> = [
  { rarity: "common", buybackUsdc: 8, name: "Common Card" },
  { rarity: "uncommon", buybackUsdc: 20, name: "Uncommon Card" },
  { rarity: "rare", buybackUsdc: 60, name: "Rare Card" },
  { rarity: "epic", buybackUsdc: 150, name: "Epic Card" },
];

const exclusionCountFor = (seats: number) => (seats === 5 ? 1 : 2);

function shuffledMascotKeys(exclude: string): string[] {
  const pool = MASCOTS.map((m) => m.key).filter((k) => k !== exclude);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function buildRoster(myMascotKey: string, seats: number): DemoPlayer[] {
  const bots = shuffledMascotKeys(myMascotKey);
  return Array.from({ length: seats }, (_, i) => ({
    seatNumber: i + 1,
    mascotKey: i === 0 ? myMascotKey : bots[(i - 1) % bots.length],
    isMe: i === 0,
    excluded: false,
  }));
}

export default function GachaDemoPage() {
  const [stage, setStage] = useState<DemoStage>("pick");
  const [seats, setSeats] = useState(5);
  const [mascotKey, setMascotKey] = useState<string | null>(null);
  const [players, setPlayers] = useState<DemoPlayer[]>([]);
  const [joinedCount, setJoinedCount] = useState(1);

  const [readySeatNumbers, setReadySeatNumbers] = useState<number[]>([]);
  const [autoOpen, setAutoOpen] = useState(false);
  const [rarity, setRarity] = useState<(typeof RARITIES)[number] | null>(null);
  const [revealedCard, setRevealedCard] = useState<GachaOpenResult | null>(null);

  const [finalVictims, setFinalVictims] = useState<number[] | null>(null);

  const [round, setRound] = useState(1);
  const [tally, setTally] = useState<Record<number, boolean>>({});
  const [myVote, setMyVote] = useState<boolean | undefined>(undefined);
  const [voting, setVoting] = useState(true);
  const [voteDrawInProgress, setVoteDrawInProgress] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const after = (ms: number, fn: () => void) => { const t = setTimeout(fn, ms); timers.current.push(t); };
  useEffect(() => clearTimers, []);

  const reset = () => {
    clearTimers();
    setStage("pick");
    setSeats(5);
    setMascotKey(null);
    setPlayers([]);
    setJoinedCount(1);
    setReadySeatNumbers([]);
    setAutoOpen(false);
    setRarity(null);
    setRevealedCard(null);
    setFinalVictims(null);
    setRound(1);
    setTally({});
    setMyVote(undefined);
    setVoting(true);
    setVoteDrawInProgress(false);
  };

  const handleLocalMascotPick = async (key: string) => {
    setMascotKey(key);
    setPlayers(buildRoster(key, seats));
    setJoinedCount(1);
    setStage("lobby");
    return { ok: true };
  };

  const changeSize = (s: number) => {
    if (!mascotKey) return;
    setSeats(s);
    setPlayers(buildRoster(mascotKey, s));
    setJoinedCount(1);
  };

  // Lobby: bots trickle in slowly, at random intervals — not instantly.
  useEffect(() => {
    if (stage !== "lobby") return;
    if (joinedCount >= seats) {
      after(900, () => setStage("rip"));
      return;
    }
    after(350 + Math.random() * 550, () => setJoinedCount((n) => Math.min(seats, n + 1)));
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, joinedCount, seats]);

  // Rip: pick the rarity the instant the ready-gate opens, bots ready up on their own staggered
  // timers, then GachaPack3D auto-opens once everyone (incl. you) is ready.
  useEffect(() => {
    if (stage !== "rip") return;
    setRarity(RARITIES[Math.floor(Math.random() * RARITIES.length)]);
    const botSeats = players.filter((p) => !p.isMe).map((p) => p.seatNumber);
    botSeats.forEach((seatNumber, i) =>
      after(800 + i * (600 + Math.random() * 900), () => setReadySeatNumbers((r) => (r.includes(seatNumber) ? r : [...r, seatNumber]))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const iAmReady = readySeatNumbers.includes(1);
  useEffect(() => {
    if (stage === "rip" && iAmReady && readySeatNumbers.length >= seats) setAutoOpen(true);
  }, [stage, iAmReady, readySeatNumbers, seats]);

  // Roulette resolution — same fixed local timer GachaRoulette's own spin then locks onto once
  // finalVictims stops being null (see GachaRoulette.tsx for the shared reveal choreography).
  useEffect(() => {
    if (stage !== "excluding" || finalVictims) return;
    const survivorSeats = players.filter((p) => !p.excluded).map((p) => p.seatNumber);
    if (!survivorSeats.length) return;
    after(2200, () => {
      const pickCount = Math.min(exclusionCountFor(seats), survivorSeats.length);
      const shuffled = [...survivorSeats].sort(() => Math.random() - 0.5);
      const victims = shuffled.slice(0, pickCount);
      setFinalVictims(victims);
      setPlayers((ps) => ps.map((p) => (victims.includes(p.seatNumber) ? { ...p, excluded: true } : p)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, finalVictims]);

  const survivors = players.filter((p) => !p.excluded);

  const launchVoteRound = (r: number) => {
    setRound(r);
    setTally({});
    setMyVote(undefined);
    setVoting(true);
    const alive = players.filter((p) => !p.excluded);
    const bots = alive.filter((p) => !p.isMe);
    const yesProbability = Math.max(0.72 - (r - 1) * 0.28, 0.08);
    bots.forEach((b, i) =>
      after(900 + i * 650 + Math.random() * 400, () => setTally((t) => ({ ...t, [b.seatNumber]: Math.random() < yesProbability }))),
    );
  };

  useEffect(() => {
    if (stage !== "voting" || !voting) return;
    const alive = players.filter((p) => !p.excluded);
    const votes = alive.map((p) => (p.seatNumber === 1 ? myVote : tally[p.seatNumber])).filter((v) => v !== undefined);
    const iAmPending = alive.some((p) => p.isMe) && myVote === undefined;
    if (iAmPending || votes.length < alive.length) return;
    setVoting(false);
    const yesCount = votes.filter(Boolean).length;
    const passed = yesCount * 2 >= votes.length; // ties count as YES
    after(1100, () => {
      if (passed && alive.length > 1) {
        setVoteDrawInProgress(true);
        after(1500, () => {
          const victim = alive[Math.floor(Math.random() * alive.length)];
          setPlayers((ps) => ps.map((p) => (p.seatNumber === victim.seatNumber ? { ...p, excluded: true } : p)));
          setVoteDrawInProgress(false);
          const stillIn = players.filter((p) => !p.excluded && p.seatNumber !== victim.seatNumber);
          if (stillIn.length > 1) launchVoteRound(round + 1);
          else setStage("settled");
        });
      } else {
        setStage("settled");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, voting, tally, myVote]);

  const castVote = (vote: boolean) => setMyVote(vote);

  const potUsdc = rarity?.buybackUsdc ?? 0;
  const me = players.find((p) => p.isMe) ?? null;
  const myMascot = getMascot(me?.mascotKey);
  const iWon = !!me && !me.excluded;
  const payoutUsdc = survivors.length ? potUsdc / survivors.length : 0;

  const toChipPlayer = (p: DemoPlayer): ChipPlayer => ({
    seatNumber: p.seatNumber,
    mascotKey: p.mascotKey,
    name: getMascot(p.mascotKey)?.name ?? `Seat ${p.seatNumber}`,
    isMe: p.isMe,
    excluded: p.excluded,
  });

  const voteSurvivors: VoteParticipant[] = survivors.map((p) => ({
    seatNumber: p.seatNumber,
    username: getMascot(p.mascotKey)?.name ?? null,
    isMe: p.isMe,
    mascotKey: p.mascotKey,
  }));

  let screen: React.ReactNode;

  if (stage === "pick") {
    screen = <MascotPicker lockedMascotKey={null} onLock={handleLocalMascotPick} />;
  } else if (stage === "lobby") {
    const full = joinedCount >= seats;
    screen = (
      <Shell
        kicker="2 / 6 · LOBBY"
        title="THE"
        titleGrad="ROOM"
        sub={full ? "room is full. no backing out now." : "degens joining…"}
        footer={
          <button type="button" className={"pp-btn gold" + (full ? " waitpulse" : "")} disabled>
            {full ? "RIP THE PACK →" : `waiting ${joinedCount}/${seats}`}
          </button>
        }
      >
        <div className="pp-sizetoggle">
          {[5, 10].map((s) => (
            <button key={s} type="button" className={"pp-seg" + (seats === s ? " on" : "")} onClick={() => changeSize(s)}>
              {s} players
            </button>
          ))}
        </div>
        <div className="pp-lobbygrid">
          {players.slice(0, seats).map((p, i) =>
            i < joinedCount ? <Chip key={p.seatNumber} p={toChipPlayer(p)} mood={p.isMe ? "happy" : "idle"} /> : <div key={`slot${i}`} className="pp-slot">?</div>,
          )}
        </div>
      </Shell>
    );
  } else if (stage === "rip") {
    screen = (
      <div className="pp-shell pp-rip">
        <div className="pp-glow" />
        <div className="pp-ripbar">
          <span aria-hidden style={{ width: 1 }} />
          <div className="pp-ripchips">
            {players.map((p) => {
              const m = getMascot(p.mascotKey);
              const isReady = readySeatNumbers.includes(p.seatNumber);
              return (
                <div key={p.seatNumber} className={"pp-minichip" + (isReady ? " rdy" : "")}>
                  {m && <Mascot name={m.key} mood={isReady ? "happy" : "idle"} size={40} title={m.name} />}
                </div>
              );
            })}
          </div>
          <span className="pp-kicker">3 / 6 · {autoOpen ? "ripping…" : `ready ${readySeatNumbers.length}/${seats}`}</span>
        </div>
        <div className="absolute inset-0">
          <GachaPack3D
            autoOpen={autoOpen}
            resolveOpen={() => new Promise<GachaOpenResult>((resolve) => {
              const check = () => (rarity ? resolve({ nftMetadata: { name: rarity.name }, rarity: rarity.rarity }) : setTimeout(check, 200));
              check();
            })}
            onOpened={(result) => { setRevealedCard(result); after(1600, () => setStage("excluding")); }}
            idleSubtitle={autoOpen ? "ripping the pack…" : "waiting for everyone to be ready…"}
            openingLabel="opening the pack…"
            hintTop={84}
          />
        </div>
        <div className="pp-ripfoot">
          {!iAmReady && <button type="button" className="pp-btn gold" onClick={() => setReadySeatNumbers((r) => [...r, 1])}>I&apos;M READY 🔥</button>}
          {iAmReady && !autoOpen && <span className="pp-small waitpulse">waiting on the room…</span>}
          {autoOpen && <span className="pp-small waitpulse">pack is ripping itself…</span>}
        </div>
      </div>
    );
  } else if (stage === "excluding") {
    screen = (
      <GachaRoulette
        players={players.map(toChipPlayer)}
        cardName={revealedCard?.nftMetadata?.name ?? rarity?.name}
        rarity={rarity?.rarity}
        potUsdc={potUsdc}
        exclusionCount={exclusionCountFor(seats)}
        finalVictims={finalVictims}
        onContinue={() => {
          const stillIn = players.filter((p) => !p.excluded);
          if (stillIn.length > 1) { setStage("voting"); launchVoteRound(1); } else setStage("settled");
        }}
      />
    );
  } else if (stage === "voting") {
    screen = <VoteRound round={round} survivors={voteSurvivors} potUsdc={potUsdc} myVote={myVote} onVote={castVote} drawInProgress={voteDrawInProgress} />;
  } else {
    screen = (
      <Shell
        kicker="6 / 6 · PAYOUT"
        title="WINNERS"
        titleGrad="EAT"
        sub="buyback settled. instantly. obviously."
        footer={
          <div className="pp-votebtns">
            <button type="button" className="pp-btn gold" onClick={reset}>RUN IT BACK →</button>
          </div>
        }
      >
        {!iWon && myMascot && (
          <div className="flex flex-col items-center gap-2 mb-6">
            <Mascot name={myMascot.key} mood="sad" size={100} />
            <p className="pp-small" style={{ marginTop: 0 }}>you were excluded this round — no payout</p>
          </div>
        )}
        <div className="pp-winrow">
          {survivors.map((p) => (
            <div key={p.seatNumber} className="pp-winner">
              <Chip p={toChipPlayer(p)} mood={p.isMe ? "winning" : "idle"} size={96} />
              <div className="pp-payout">+{money(payoutUsdc)}</div>
            </div>
          ))}
        </div>
        <div className="pp-pot">POT {money(potUsdc)} · SPLIT {survivors.length} WAYS</div>
      </Shell>
    );
  }

  return (
    <div className="relative min-h-screen">
      <Link href="/app/gacha" className="absolute left-4 top-4 z-20 flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm">
        <ChevronLeft className="w-4 h-4" /> Rooms
      </Link>
      {screen}
    </div>
  );
}
