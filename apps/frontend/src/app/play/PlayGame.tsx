"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PlayWorld } from "./playWorlds";
import { BONUSES } from "./playBonuses";

/**
 * Side scroller on a canvas. Tap, click or press space to jump. Jump over fees, grab USDC, hit the
 * floating app blocks for power-ups, run through the gate into the next country. Every country has its
 * own music, and each payout app has its own power-up in the countries where it works.
 */

const VW = 960;
const VH = 540;
const GROUND = 440;
const HERO_X = 150;
const HERO_W = 48;
const HERO_H = 56;
const GRAVITY = 0.72;
const JUMP_V = -14.2;
const BLINK_FRAMES = 70;
const BONUS_Y = GROUND - 215;
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

export type RunEvent = "coin" | "hit" | "dodge" | "bonus";
export type RunResult = { coins: number; hits: number; dodged: number; bonuses: number; trail: RunEvent[][] };
export type ActiveFx = { id: string; name: string; color: string; logo: string; left: number };
export type Unlock = { id: string; name: string; desc: string; color: string; logo: string; n: number };

type Kind = "coin" | "fee" | "gate" | "bonus";
type Item = { kind: Kind; x: number; y: number; w: number; h: number; done?: boolean; seg: number; app?: string };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Pop = { x: number; y: number; text: string; age: number; color: string };

const HERO_MAP = [
  "....CCCC....",
  "...CCCCCC...",
  "..CCCCCCCC..",
  ".WWWWWWWWWW.",
  "...SSSSSS...",
  "...SESSES...",
  "...SSSSSS...",
  "....BBBB....",
  "..BBBBBBBB..",
  ".SBBWWBBBBS.",
  ".SBBBBBBBBS.",
  "..TTTTTTTT..",
];
const LEGS_A = ["..LL....LL..", "..LL....LL.."];
const LEGS_B = ["...LL..LL...", "...LL..LL..."];

const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a: string, b: string, t: number) => {
  const x = hex(a);
  const y = hex(b);
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * t)},${Math.round(x[1] + (y[1] - x[1]) * t)},${Math.round(x[2] + (y[2] - x[2]) * t)})`;
};
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Worlds with several payout apps get a longer stretch so every power-up has room. */
const segLen = (w: PlayWorld) => 1500 + 360 * Math.max(0, w.apps.length - 1);

function buildLevel(worlds: PlayWorld[]): Item[] {
  const items: Item[] = [];
  let start = 0;
  worlds.forEach((w, s) => {
    const len = segLen(w);
    const n = w.apps.length;
    const bonusXs = w.apps.map((_, k) => start + 600 + ((k + 0.5) * (len - 1000)) / Math.max(1, n));
    w.apps.forEach((a, k) => items.push({ kind: "bonus", x: bonusXs[k], y: BONUS_Y, w: 56, h: 56, seg: s, app: a.id }));
    let x = start + 520;
    let i = 0;
    while (x < start + len - 420) {
      if (bonusXs.some((bx) => Math.abs(bx - x) < 230)) {
        x += 120;
        continue;
      }
      const roll = rand(s * 97 + i * 13 + 1);
      if (roll < 0.45) {
        items.push({ kind: "fee", x, y: GROUND - 56, w: 56, h: 56, seg: s });
        x += 340 + rand(s * 31 + i) * 120;
      } else if (roll < 0.8) {
        for (let k = 0; k < 3; k++) items.push({ kind: "coin", x: x + k * 56, y: GROUND - 120 - Math.sin((k / 2) * Math.PI) * 70, w: 34, h: 34, seg: s });
        x += 300 + rand(s * 17 + i) * 120;
      } else {
        items.push({ kind: "coin", x, y: GROUND - 56, w: 34, h: 34, seg: s });
        items.push({ kind: "fee", x: x + 190, y: GROUND - 56, w: 56, h: 56, seg: s });
        x += 460;
      }
      i++;
    }
    start += len;
    items.push({ kind: "gate", x: start, y: GROUND - 260, w: 120, h: 260, seg: s });
  });
  return items;
}

/** Tiny synth for jump, coin and hit, so the basics need no files. */
function makeSynth() {
  let ctx: AudioContext | null = null;
  const blip = (freq: number, dur: number, type: OscillatorType = "square", slideTo?: number, vol = 0.07) => {
    try {
      ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (ctx.state === "suspended") void ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur);
    } catch {
      /* audio unavailable */
    }
  };
  return {
    jump: () => blip(320, 0.16, "square", 640),
    coin: () => {
      blip(988, 0.08);
      setTimeout(() => blip(1319, 0.14), 70);
    },
    hit: () => blip(180, 0.28, "sawtooth", 60, 0.1),
    gate: () => {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.14, "triangle", undefined, 0.09), i * 90));
    },
  };
}

/** One looping track per country, crossfaded as you run through the gates. */
function makeMusic() {
  const MAX = 0.4;
  let current: HTMLAudioElement | null = null;
  let muted = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const fading = new Set<HTMLAudioElement>();

  const tick = () => {
    if (current && !current.paused) current.volume = Math.min(muted ? 0 : MAX, current.volume + 0.02);
    fading.forEach((a) => {
      a.volume = Math.max(0, a.volume - 0.03);
      if (a.volume <= 0.001) {
        a.pause();
        fading.delete(a);
      }
    });
    if (!fading.size && (!current || current.volume >= (muted ? 0 : MAX) - 0.001) && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const run = () => {
    timer ??= setInterval(tick, 40);
  };

  return {
    set(id: string) {
      if (current) fading.add(current);
      const a = new Audio(`/play/audio/music-${id}.mp3`);
      a.loop = true;
      a.volume = 0;
      current = a;
      if (!muted) void a.play().catch(() => {});
      run();
    },
    mute(m: boolean) {
      muted = m;
      if (!current) return;
      if (m) {
        current.volume = 0;
        current.pause();
      } else {
        void current.play().catch(() => {});
        run();
      }
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      current?.pause();
      fading.forEach((a) => a.pause());
      fading.clear();
      current = null;
    },
  };
}

export function PlayGame({
  worlds,
  running,
  muted,
  fullscreen,
  onWorld,
  onCoins,
  onFx,
  onUnlock,
  onFinish,
}: {
  worlds: PlayWorld[];
  running: boolean;
  muted: boolean;
  fullscreen: boolean;
  onWorld: (index: number) => void;
  onCoins: (coins: number, fees: number) => void;
  onFx: (fx: ActiveFx[]) => void;
  onUnlock: (u: Unlock) => void;
  onFinish: (result: RunResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const jumpRef = useRef<() => void>(() => {});
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const musicRef = useRef<ReturnType<typeof makeMusic> | null>(null);
  const cb = useRef({ onWorld, onCoins, onFx, onUnlock, onFinish });
  cb.current = { onWorld, onCoins, onFx, onUnlock, onFinish };

  const jump = useCallback(() => jumpRef.current(), []);

  useEffect(() => {
    musicRef.current?.mute(muted);
  }, [muted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = 2;
    canvas.width = VW * dpr;
    canvas.height = VH * dpr;
    ctx.scale(dpr, dpr);

    const items = buildLevel(worlds);
    const synth = makeSynth();
    const music = makeMusic();
    if (running) {
      musicRef.current = music;
      music.mute(mutedRef.current);
    }
    const play = (fn: () => void) => {
      if (!mutedRef.current) fn();
    };
    const sting = (id: string) => {
      if (mutedRef.current) return;
      const a = new Audio(`/play/audio/sfx-${id}.mp3`);
      a.volume = 0.85;
      void a.play().catch(() => {});
    };

    const logos: Record<string, HTMLImageElement> = {};
    const logoUrl: Record<string, string> = {};
    worlds.forEach((w) =>
      w.apps.forEach((a) => {
        if (!logos[a.id]) {
          const img = new Image();
          img.src = a.logo;
          logos[a.id] = img;
          logoUrl[a.id] = a.logo;
        }
      }),
    );

    let cam = 0;
    let heroY = GROUND - HERO_H;
    let vy = 0;
    let coins = 0;
    let fees = 0;
    let dodged = 0;
    let bonuses = 0;
    let worldIdx = 0;
    let prevWorld = 0;
    let transition = 1;
    let blink = 0;
    let finishing = 0;
    let finished = false;
    let frame = 0;
    let shake = 0;
    let flash = 0;
    let flashColor = "#ffffff";
    let flashGlyph = "";
    let scan = -1;
    let shield = false;
    let lastFxPush = 0;
    const fx = new Map<string, number>();
    const pops: Pop[] = [];
    const parts: Particle[] = [];
    const trail: RunEvent[][] = worlds.map(() => []);
    let last = performance.now();
    let raf = 0;

    if (running) music.set(worlds[0].music);

    const onGround = () => heroY >= GROUND - HERO_H - 0.5;
    jumpRef.current = () => {
      if (!running || finished) return;
      if (onGround()) {
        vy = JUMP_V;
        play(synth.jump);
      }
    };

    const burst = (x: number, y: number, color: string, n: number, spread = 6) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 1 + Math.random() * spread;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 0, max: 30 + Math.random() * 22, color, size: 4 + Math.random() * 5 });
      }
    };
    const pop = (text: string, color: string, y = heroY - 10) => pops.push({ x: HERO_X, y, text, age: 0, color });
    const multiplier = () => (fx.has("xmoney") ? 3 : fx.has("venmo") || fx.has("paj") ? 2 : 1);
    const addCoins = (n: number, seg: number, sound = true) => {
      const v = n * multiplier();
      coins += v;
      trail[seg]?.push("coin");
      pop(`+${v}`, "#ffd23f");
      if (sound) play(synth.coin);
      cb.current.onCoins(coins, fees);
    };
    const spawnShower = (hx: number, seg: number, n: number) => {
      for (let k = 0; k < n; k++) items.push({ kind: "coin", x: hx + 260 + k * 46, y: GROUND - 90 - Math.abs(Math.sin(k * 0.7)) * 120, w: 34, h: 34, seg });
    };
    const pushFx = () => {
      const list: ActiveFx[] = [];
      fx.forEach((until, id) => {
        const b = BONUSES[id];
        list.push({ id, name: b.name, color: b.color, logo: logoUrl[id] ?? "", left: Math.max(0, (until - frame) / b.frames) });
      });
      cb.current.onFx(list);
    };

    const unlock = (it: Item) => {
      const id = it.app as string;
      const b = BONUSES[id];
      if (!b) return;
      it.done = true;
      bonuses++;
      trail[it.seg]?.push("bonus");
      sting(id);
      cb.current.onUnlock({ id, name: b.name, desc: b.desc, color: b.color, logo: logoUrl[id] ?? "", n: bonuses });
      burst(it.x - cam + 28, it.y + 28, b.color, 26, 9);
      const hx = cam + HERO_X;
      if (b.frames) fx.set(id, frame + b.frames);
      flash = 14;
      flashColor = b.color;
      flashGlyph = "";
      switch (id) {
        case "venmo":
          burst(HERO_X + 24, heroY + 20, "#8fd0ff", 30, 8);
          break;
        case "cashapp":
          spawnShower(hx, it.seg, 14);
          break;
        case "revolut":
          shake = 12;
          break;
        case "zelle":
          for (const f of items) {
            if (f.kind === "fee" && !f.done && f.x > hx && f.x < hx + 1500) {
              f.done = true;
              dodged++;
              trail[f.seg]?.push("dodge");
              burst(f.x - cam + 28, f.y + 28, "#c9a6ff", 12, 7);
            }
          }
          flash = 20;
          break;
        case "xmoney":
          coins += 10;
          trail[it.seg]?.push("coin");
          pop("+10", "#ffffff", heroY - 40);
          shake = 26;
          flash = 26;
          flashColor = "#000000";
          flashGlyph = "X";
          cb.current.onCoins(coins, fees);
          break;
        case "monzo":
          coins += 5;
          shield = true;
          trail[it.seg]?.push("coin");
          pop("+5", "#ffd23f", heroY - 40);
          cb.current.onCoins(coins, fees);
          break;
        case "upi": {
          scan = 0;
          let got = 0;
          for (const c of items) {
            if (c.kind === "coin" && !c.done && c.x > hx - 60 && c.x < hx + 900) {
              c.done = true;
              got++;
            }
          }
          if (got) addCoins(got, it.seg, false);
          break;
        }
        case "paj":
          spawnShower(hx, it.seg, 10);
          break;
        default:
          break;
      }
      pushFx();
    };

    const skylines = worlds.map((_, idx) => Array.from({ length: 30 }, (_, i) => ({ x: i * 90, w: 60 + rand(idx * 50 + i) * 36, h: 60 + rand(idx * 70 + i + 9) * 190 })));

    const drawSprite = (map: string[], x: number, y: number, px: number, palette: Record<string, string>) => {
      map.forEach((row, ry) =>
        [...row].forEach((ch, rx) => {
          const c = palette[ch];
          if (c) {
            ctx.fillStyle = c;
            ctx.fillRect(Math.round(x + rx * px), Math.round(y + ry * px), px + 0.5, px + 0.5);
          }
        }),
      );
    };

    const drawBackground = (w: PlayWorld, p: PlayWorld, t: number, idx: number) => {
      const g = ctx.createLinearGradient(0, 0, 0, GROUND);
      g.addColorStop(0, mix(p.sky[0], w.sky[0], t));
      g.addColorStop(1, mix(p.sky[1], w.sky[1], t));
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, VW + 40, VH + 40);

      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 420px Arial Black, Helvetica, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(w.symbol.length > 3 ? w.currency : w.symbol, VW / 2, 360);
      ctx.restore();

      ctx.font = `64px ${EMOJI_FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(w.flag, VW / 2, 96);

      const buildings = skylines[idx];
      const farOff = (cam * 0.25) % (30 * 90);
      ctx.fillStyle = mix(w.sky[1], "#0d1230", 0.55);
      buildings.forEach((b) => {
        let x = b.x - farOff;
        if (x < -b.w) x += 30 * 90;
        ctx.fillRect(x, GROUND - b.h, b.w, b.h);
      });
      const nearOff = (cam * 0.55) % (30 * 90);
      const nearColor = mix(w.sky[1], "#0d1230", 0.75);
      buildings.forEach((b, i) => {
        let x = b.x + 45 - nearOff;
        if (x < -b.w) x += 30 * 90;
        const h = b.h * 0.55 + 30;
        ctx.fillStyle = nearColor;
        ctx.fillRect(x, GROUND - h, b.w * 0.8, h);
        if (i % 3 === 0) {
          ctx.fillStyle = w.accent;
          ctx.globalAlpha = 0.6;
          ctx.fillRect(x + 8, GROUND - h + 10, 8, 8);
          ctx.globalAlpha = 1;
        }
      });

      ctx.fillStyle = w.ground;
      ctx.fillRect(-20, GROUND, VW + 40, VH - GROUND + 20);
      ctx.fillStyle = w.accent;
      ctx.fillRect(-20, GROUND, VW + 40, 10);
      ctx.fillStyle = "rgba(255,255,255,.12)";
      for (let x = -(cam % 80); x < VW; x += 80) ctx.fillRect(x, GROUND + 60, 40, 8);
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(2.5, (now - last) / 16.667);
      last = now;
      frame += dt;
      const w = worlds[Math.min(worldIdx, worlds.length - 1)];
      const p = worlds[prevWorld];
      const rocket = fx.has("revolut");
      const magnet = fx.has("chime");

      if (running && !finished) {
        const speed = (5.4 + Math.min(1.6, cam / 9000)) * (rocket ? 1.7 : 1);
        if (finishing > 0) {
          finishing -= dt;
          if (finishing <= 0) {
            finished = true;
            music.stop();
            cb.current.onFinish({ coins, hits: fees, dodged, bonuses, trail });
          }
        } else {
          cam += speed * dt;
        }
        vy += GRAVITY * dt;
        heroY += vy * dt;
        if (heroY > GROUND - HERO_H) {
          heroY = GROUND - HERO_H;
          vy = 0;
        }
        if (blink > 0) blink -= dt;
        if (shake > 0) shake -= dt;
        if (flash > 0) flash -= dt;
        if (scan >= 0) scan = scan + dt > 36 ? -1 : scan + dt;
        if (transition < 1) transition = Math.min(1, transition + dt / 45);

        let fxChanged = false;
        fx.forEach((until, id) => {
          if (frame >= until) {
            fx.delete(id);
            fxChanged = true;
          }
        });
        if (fxChanged || (fx.size && frame - lastFxPush > 6)) {
          lastFxPush = frame;
          pushFx();
        }

        const hx = cam + HERO_X;
        for (const it of items) {
          if (it.done) continue;
          if (it.kind === "gate") {
            if (hx > it.x) {
              it.done = true;
              play(synth.gate);
              if (it.seg + 1 < worlds.length) {
                prevWorld = worldIdx;
                worldIdx = it.seg + 1;
                transition = 0;
                cb.current.onWorld(worldIdx);
                music.set(worlds[worldIdx].music);
              } else {
                finishing = 50;
              }
            }
            continue;
          }
          if (it.kind === "coin" && magnet && Math.abs(it.x - hx) < 340) {
            it.x += (hx + HERO_W / 2 - it.x) * 0.16 * dt;
            it.y += (heroY + 20 - it.y) * 0.16 * dt;
          }
          const overlapX = hx + 8 < it.x + it.w && hx + HERO_W - 8 > it.x;
          const overlapY = heroY + 6 < it.y + it.h && heroY + HERO_H > it.y + (it.kind === "fee" ? 14 : 0);
          if (!(overlapX && overlapY)) {
            if (it.kind === "fee" && hx > it.x + it.w + 12) {
              it.done = true;
              dodged++;
              trail[it.seg]?.push("dodge");
            }
            continue;
          }
          if (it.kind === "bonus") {
            unlock(it);
          } else if (it.kind === "coin") {
            it.done = true;
            addCoins(1, it.seg);
          } else if (rocket) {
            it.done = true;
            burst(it.x - cam + 28, it.y + 28, "#ff7a2a", 16, 8);
            addCoins(1, it.seg, false);
            pop("SMASH", "#ffffff", heroY - 30);
          } else if (shield) {
            it.done = true;
            shield = false;
            burst(HERO_X + 24, heroY + 28, "#ff9d93", 20, 7);
            pop("BLOCKED", "#ff4f40", heroY - 30);
            play(synth.hit);
          } else if (blink <= 0) {
            it.done = true;
            fees++;
            coins = Math.max(0, coins - 1);
            blink = BLINK_FRAMES;
            trail[it.seg]?.push("hit");
            pop("FEE", "#ff5a5a");
            play(synth.hit);
            cb.current.onCoins(coins, fees);
          }
        }
      }

      const idx = Math.min(worldIdx, worlds.length - 1);
      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      drawBackground(w, p, transition, idx);

      if (rocket) {
        ctx.fillStyle = "rgba(255,255,255,.55)";
        for (let i = 0; i < 14; i++) {
          const y = 40 + rand(i + 3) * (GROUND - 80);
          const x = VW - ((frame * 38 + i * 140) % (VW + 200));
          ctx.fillRect(x, y, 120, 3);
        }
      }

      for (const it of items) {
        const sx = it.x - cam;
        if (sx < -160 || sx > VW + 160) continue;
        if (it.kind === "gate") {
          const next = worlds[Math.min(it.seg + 1, worlds.length - 1)];
          ctx.fillStyle = "#1d2236";
          ctx.fillRect(sx, it.y, 20, it.h);
          ctx.fillRect(sx + it.w - 20, it.y, 20, it.h);
          ctx.fillStyle = next.accent;
          ctx.fillRect(sx - 6, it.y - 10, it.w + 12, 30);
          ctx.font = `34px ${EMOJI_FONT}`;
          ctx.textAlign = "center";
          ctx.fillStyle = "#fff";
          ctx.fillText(it.seg + 1 < worlds.length ? next.flag : "🏁", sx + it.w / 2, it.y + 14);
          ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.15 * Math.sin(frame / 8)})`;
          ctx.fillRect(sx + 20, it.y + 20, it.w - 40, it.h - 20);
        } else if (it.done) {
          continue;
        } else if (it.kind === "bonus") {
          const b = BONUSES[it.app as string];
          const cx = sx + 28;
          const cy = it.y + 28 + Math.sin(frame / 10 + it.x) * 6;
          const glow = ctx.createRadialGradient(cx, cy, 6, cx, cy, 58);
          glow.addColorStop(0, `${b.color}cc`);
          glow.addColorStop(1, `${b.color}00`);
          ctx.fillStyle = glow;
          ctx.fillRect(cx - 60, cy - 60, 120, 120);
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.roundRect(cx - 30, cy - 30, 60, 60, 14);
          ctx.fill();
          const img = logos[it.app as string];
          if (img?.complete && img.naturalWidth) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(cx - 26, cy - 26, 52, 52, 11);
            ctx.clip();
            ctx.drawImage(img, cx - 26, cy - 26, 52, 52);
            ctx.restore();
          }
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.roundRect(cx - 30, cy - 30, 60, 60, 14);
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.font = "700 15px Arial Black, Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("BONUS", cx, cy + 50);
        } else if (it.kind === "coin") {
          const sc = Math.max(0.2, Math.abs(Math.cos(frame / 10 + it.x)));
          ctx.fillStyle = "#14508f";
          ctx.beginPath();
          ctx.ellipse(sx + 17, it.y + 17, 17 * sc, 17, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#2775ca";
          ctx.beginPath();
          ctx.ellipse(sx + 17, it.y + 17, 13 * sc, 13, 0, 0, Math.PI * 2);
          ctx.fill();
          if (sc > 0.55) {
            ctx.fillStyle = "#fff";
            ctx.font = "700 18px Arial, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("$", sx + 17, it.y + 24);
          }
        } else {
          ctx.fillStyle = "#7a1010";
          ctx.fillRect(sx, it.y, it.w, it.h);
          ctx.fillStyle = "#e03131";
          ctx.fillRect(sx + 4, it.y + 4, it.w - 8, it.h - 8);
          ctx.fillStyle = "#fff";
          ctx.font = "700 20px Arial Black, Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("FEE", sx + it.w / 2, it.y + 36);
        }
      }

      const hcx = HERO_X + HERO_W / 2;
      const hcy = heroY + HERO_H / 2;
      fx.forEach((_, id) => {
        ctx.strokeStyle = BONUSES[id].color;
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(frame / 5);
        ctx.beginPath();
        ctx.arc(hcx, hcy, 44 + Math.sin(frame / 6) * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (id === "venmo" && Math.random() < 0.4) parts.push({ x: hcx + (Math.random() - 0.5) * 50, y: hcy + 20, vx: (Math.random() - 0.5) * 2, vy: -2 - Math.random() * 2, life: 0, max: 26, color: "#8fd0ff", size: 5 });
        if (id === "chime" && Math.random() < 0.5) parts.push({ x: hcx + (Math.random() - 0.5) * 80, y: hcy + (Math.random() - 0.5) * 80, vx: 0, vy: -1, life: 0, max: 22, color: "#9dffd2", size: 4 });
        if (id === "xmoney" && Math.random() < 0.5) parts.push({ x: hcx + (Math.random() - 0.5) * 60, y: hcy + (Math.random() - 0.5) * 60, vx: 0, vy: 0, life: 0, max: 12, color: Math.random() < 0.5 ? "#ffffff" : "#000000", size: 8 });
        if (id === "paj" && Math.random() < 0.5) parts.push({ x: Math.random() * VW, y: -10, vx: 0, vy: 4 + Math.random() * 3, life: 0, max: 90, color: "#15a05a", size: 8 });
      });
      if (rocket) {
        for (let i = 0; i < 4; i++) parts.push({ x: HERO_X - 4, y: hcy + (Math.random() - 0.5) * 24, vx: -4 - Math.random() * 4, vy: (Math.random() - 0.5) * 1.5, life: 0, max: 20, color: Math.random() < 0.5 ? "#ff7a2a" : "#ffd23f", size: 8 });
      }
      if (shield) {
        ctx.strokeStyle = "#ff9d93";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(hcx, hcy, 40, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (!(blink > 0 && Math.floor(frame / 4) % 2)) {
        const legs = !onGround() ? LEGS_A : Math.floor(frame / (rocket ? 3 : 6)) % 2 ? LEGS_B : LEGS_A;
        drawSprite([...HERO_MAP, ...legs], HERO_X, heroY, 4, { C: w.accent, W: "#ffffff", B: "#2f5bff", T: "#ffffff", S: "#ffcf6b", E: "#0d1230", L: "#1d2a6b" });
      }

      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.life += dt;
        if (q.life > q.max) {
          parts.splice(i, 1);
          continue;
        }
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vy += 0.12 * dt;
        ctx.globalAlpha = 1 - q.life / q.max;
        ctx.fillStyle = q.color;
        ctx.fillRect(q.x, q.y, q.size, q.size);
        ctx.globalAlpha = 1;
      }

      for (let i = pops.length - 1; i >= 0; i--) {
        const pp = pops[i];
        pp.age += dt;
        if (pp.age > 34) {
          pops.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 1 - pp.age / 34;
        ctx.fillStyle = pp.color;
        ctx.font = "700 30px Arial Black, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(pp.text, pp.x + HERO_W / 2, pp.y - pp.age * 1.6);
        ctx.globalAlpha = 1;
      }

      if (scan >= 0) {
        const x = (scan / 36) * VW;
        ctx.fillStyle = "rgba(242,107,33,.25)";
        ctx.fillRect(0, 0, x, VH);
        ctx.fillStyle = "#f26b21";
        ctx.fillRect(x - 3, 0, 6, VH);
      }
      ctx.restore();

      if (flash > 0) {
        ctx.globalAlpha = Math.min(0.55, flash / 30);
        ctx.fillStyle = flashColor;
        ctx.fillRect(0, 0, VW, VH);
        if (flashGlyph) {
          ctx.globalAlpha = Math.min(1, flash / 14);
          ctx.fillStyle = "#ffffff";
          ctx.font = "700 460px Arial Black, Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(flashGlyph, VW / 2, 400);
        }
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jumpRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      music.stop();
      if (musicRef.current === music) musicRef.current = null;
      cb.current.onFx([]);
    };
    // The route is fixed per run, so the engine only restarts when the worlds or the running flag change.
  }, [worlds, running]);

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={jump}
      className={
        fullscreen
          ? "block aspect-[16/9] w-[min(100vw,177.78vh)] touch-none select-none bg-[#0d1230]"
          : "block w-full aspect-[16/9] touch-none select-none rounded-2xl border border-white/10 bg-[#0d1230]"
      }
      aria-label="Loofta World game. Tap or press space to jump."
    />
  );
}
