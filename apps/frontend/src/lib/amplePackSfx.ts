'use client';

import { useEffect, useState } from 'react';

/**
 * Sound effects, synthesized with Web Audio (no files to load): the pack charging, tearing and the reveal hit, and the
 * Death mode roulette (cylinder clicks, the shot, the dry click when a totem saves someone). On by default; the menu
 * has a switch, remembered per device. Browsers only allow audio after a tap, so the context starts on the first one.
 */

const KEY = 'ample-pack:sound';
const EVENT = 'ample-pack:sound-change';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

export function soundOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSoundOn(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: this session only */ }
  if (master) master.gain.value = on ? 0.55 : 0;
  window.dispatchEvent(new Event(EVENT));
}

/** The sound switch's state, kept in sync across components. */
export function useSoundOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const sync = () => setOn(soundOn());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [on, setSoundOn];
}

// Real recordings (public/sfx/*.mp3). Each one is optional: a missing file falls back to the synthesized version.
// charge = the build-up before the tear, tear = the foil ripping, reveal = the cinematic reveal (its hit lands
// REVEAL_HIT seconds into the file, so it starts that much before the card flips), heartbeat = the Death mode vote loop.
// Add a name here when its file is added (charge, tear); only listed files are fetched.
const SAMPLE_NAMES = ['reveal', 'heartbeat'] as const;
const REVEAL_HIT = 1.5;
const samples = new Map<string, AudioBuffer | null>();
function loadSamples(c: AudioContext) {
  for (const n of SAMPLE_NAMES) {
    if (samples.has(n)) continue;
    samples.set(n, null);
    fetch(`/sfx/${n}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((b) => c.decodeAudioData(b)).then((buf) => { samples.set(n, buf); }).catch(() => undefined);
  }
}
/** Plays a recording if it loaded, `delay` seconds from now (a negative delay starts that far into it); false means use the synth. */
function sample(name: string, delay = 0, seconds = 0): boolean {
  const buf = samples.get(name);
  if (!buf) return false;
  play((c, out, t) => { const s = c.createBufferSource(), g = c.createGain(), at = t + Math.max(0, delay); s.buffer = buf; s.connect(g).connect(out); s.start(at, Math.max(0, -delay));
    if (seconds > 0) { g.gain.setValueAtTime(1, at + seconds); g.gain.exponentialRampToValueAtTime(0.0001, at + seconds + 0.35); s.stop(at + seconds + 0.4); } }); // `seconds`: play only that long, then fade
  return true;
}

/** Loops a recording (fading in); returns the function that fades it out. Null when it cannot play. */
function startLoop(name: string, gain = 0.9): (() => void) | null {
  const c = audio();
  const buf = samples.get(name);
  if (!c || !master || !buf || !soundOn() || c.state !== 'running') return null;
  const src = c.createBufferSource(), g = c.createGain(), t = c.currentTime;
  src.buffer = buf; src.loop = true; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.5);
  src.connect(g).connect(master); src.start(t);
  let done = false;
  return () => { if (done) return; done = true; const now = c.currentTime; g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45); src.stop(now + 0.5); };
}

/** The heartbeat under the Death mode vote: loops while `active`. */
export function useHeartbeat(active: boolean) {
  useEffect(() => (active ? startLoop('heartbeat') ?? undefined : undefined), [active]);
}

/** Plays the pack-opening sounds on the pack's own beats (its 'charge', 'tear' and 'flip' events), so they stay in sync. */
export function usePackSounds() {
  useEffect(() => {
    let recorded = false; // the recorded reveal was scheduled from the cue, so the flip does not also play the synth hit
    // every pack: the recorded heartbeat from the moment it starts charging (the whole countdown in a pool) until it tears
    let stopBeat: (() => void) | null = null;
    const onCharge = (e: Event) => { recorded = false; const sec = (e as CustomEvent).detail?.seconds ?? 3;
      stopBeat?.(); stopBeat = startLoop('heartbeat');
      if (!sample('charge')) sfx.charge(sec, !stopBeat); };
    const onTear = () => { stopBeat?.(); stopBeat = null; if (!sample('tear')) sfx.tear(); };
    // the pack says when its reveal hit lands: start the recording early enough for its own hit to land on it
    const onCue = (e: Event) => { recorded = sample('reveal', ((e as CustomEvent).detail?.hitIn ?? 1.5) - REVEAL_HIT); };
    const onFlip = (e: Event) => { if (!recorded) sfx.impact((e as CustomEvent).detail?.rarity ?? 'rare'); };
    const evs: Array<[string, (e: Event) => void]> = [['charge', onCharge], ['tear', onTear], ['cue', onCue], ['flip', onFlip]];
    evs.forEach(([n, f]) => document.addEventListener(n, f));
    return () => { stopBeat?.(); evs.forEach(([n, f]) => document.removeEventListener(n, f)); };
  }, []);
}

/** Starts audio on the first tap anywhere (browsers block sound before a user gesture). */
export function unlockAudioOnGesture() {
  const go = () => { audio(); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  window.addEventListener('pointerdown', go, { once: true });
  window.addEventListener('keydown', go, { once: true });
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = soundOn() ? 0.55 : 0;
    master.connect(ctx.destination);
    loadSamples(ctx);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Runs a sound only when it can be heard: sound on, audio unlocked, tab visible. */
function play(fn: (c: AudioContext, out: GainNode, t: number) => void) {
  if (!soundOn() || typeof document === 'undefined' || document.hidden) return;
  const c = audio();
  if (!c || !master || c.state !== 'running') return;
  try { fn(c, master, c.currentTime + 0.01); } catch { /* never let a sound break the page */ }
}

function env(c: AudioContext, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function noise(c: AudioContext, t: number, dur: number): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true; // the buffer is 1s; longer sounds (the rumble) loop it
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur);
  return s;
}

function tone(c: AudioContext, out: AudioNode, t: number, freq: number, dur: number, type: OscillatorType = 'sine', peak = 0.3) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(env(c, out, t, peak, 0.005, dur));
  o.start(t); o.stop(t + dur + 0.05);
}

/** A note through a lowpass, for warmer chords than a bare oscillator. */
function pad(c: AudioContext, out: AudioNode, t: number, freq: number, dur: number, peak: number, type: OscillatorType = 'sawtooth') {
  const o = c.createOscillator(), lp = c.createBiquadFilter(); o.type = type; o.frequency.setValueAtTime(freq, t);
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(900, t + dur);
  o.connect(lp).connect(env(c, out, t, peak, 0.012, dur)); o.start(t); o.stop(t + dur + 0.1);
}

export const sfx = {
  /**
   * The pack charging before the rip: a riser (noise and a saw sweeping up) over a heartbeat that speeds up, so the
   * tension builds to the exact moment it tears.
   */
  charge: (seconds = 1.6, beat = true) => play((c, out, t) => {
    const d = Math.max(0.4, seconds);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(260, t); bp.frequency.exponentialRampToValueAtTime(5200, t + d);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55, t + d); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.08);
    noise(c, t, d + 0.1).connect(bp).connect(g).connect(out);
    const o = c.createOscillator(), lp = c.createBiquadFilter(), og = c.createGain(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(420, t + d);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(3000, t + d);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.16, t + d); og.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.06);
    o.connect(lp).connect(og).connect(out); o.start(t); o.stop(t + d + 0.1);
    // heartbeat: double thumps, closer and closer together (skipped when the recorded heartbeat plays instead)
    if (beat) for (let at = 0, gap = 0.5; at < d - 0.05; at += gap, gap = Math.max(0.11, gap * 0.8)) {
      [0, 0.09].forEach((dt, i) => { const k = c.createOscillator(); k.type = 'sine'; k.frequency.setValueAtTime(i ? 52 : 62, t + at + dt); k.frequency.exponentialRampToValueAtTime(34, t + at + dt + 0.12);
        k.connect(env(c, out, t + at + dt, (0.5 + at / d * 0.5) * (i ? 0.55 : 0.8), 0.004, 0.14)); k.start(t + at + dt); k.stop(t + at + dt + 0.2); });
    }
  }),

  /** The foil tearing: a fast zip plus a burst of crackles, crunchy, left to right. */
  tear: () => play((c, out, t) => {
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(1800, t); bp.frequency.exponentialRampToValueAtTime(7000, t + 0.28); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.6);
    noise(c, t, 0.65).connect(bp).connect(env(c, out, t, 1.0, 0.01, 0.6));
    for (let i = 0; i < 26; i++) { const at = t + Math.random() * 0.55, hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500 + Math.random() * 4000;
      noise(c, at, 0.02).connect(hp).connect(env(c, out, at, 0.25 + Math.random() * 0.45, 0.001, 0.015 + Math.random() * 0.02)); }
  }),

  /**
   * The reveal hit: a sub drop, a whoosh, a bright major chord and a shower of sparkles. Rarer cards get a bigger
   * chord, a rising arpeggio and a longer glittering tail.
   */
  impact: (rarity = 'rare') => play((c, out, t) => {
    const lvl = ({ common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 } as Record<string, number>)[rarity] ?? 2;
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(140, t); sub.frequency.exponentialRampToValueAtTime(32, t + 0.7);
    sub.connect(env(c, out, t, 1.1, 0.004, 0.8)); sub.start(t); sub.stop(t + 0.9);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(8000, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.9);
    noise(c, t, 1).connect(lp).connect(env(c, out, t, 0.6, 0.005, 0.9));
    const root = [392, 440, 494, 523.25, 587.33][lvl]; // brighter key the rarer the card
    const chord = lvl >= 3 ? [1, 1.26, 1.5, 2, 2.52] : [1, 1.26, 1.5, 2];
    chord.forEach((m, i) => { pad(c, out, t + 0.02 + i * 0.012, root * m, 1.6 + lvl * 0.35, 0.09); tone(c, out, t + 0.02, root * m * 2, 0.9 + lvl * 0.2, 'triangle', 0.06); });
    if (lvl >= 2) [1, 1.26, 1.5, 2, 2.52, 3].slice(0, 3 + lvl).forEach((m, i) => tone(c, out, t + 0.12 + i * 0.07, root * m * 2, 0.35, 'triangle', 0.12));
    const n = 10 + lvl * 9, tail = 0.9 + lvl * 0.45;
    for (let i = 0; i < n; i++) { const at = t + 0.15 + Math.random() * tail; tone(c, out, at, 2400 + Math.random() * 4200, 0.12 + Math.random() * 0.18, 'sine', 0.035 + Math.random() * 0.05); }
  }),


  /** Countdown beep before the pack opens. */
  beep: (high = false) => play((c, out, t) => tone(c, out, t, high ? 1320 : 880, 0.12, 'sine', 0.22)),

  /** One revolver-cylinder click while the roulette spins. */
  click: () => play((c, out, t) => {
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    noise(c, t, 0.03).connect(hp).connect(env(c, out, t, 0.5, 0.002, 0.03));
    tone(c, out, t, 1800, 0.02, 'square', 0.06);
  }),

  /** The shot: a seat is out. */
  bang: () => play((c, out, t) => {
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    noise(c, t, 0.6).connect(lp).connect(env(c, out, t, 1.2, 0.003, 0.55));
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    o.connect(env(c, out, t, 0.9, 0.003, 0.35)); o.start(t); o.stop(t + 0.45);
  }),

  /** Empty chamber: the trigger falls on nothing (a totem saved the seat, or nobody is out). */
  dry: () => play((c, out, t) => {
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 4;
    noise(c, t, 0.05).connect(bp).connect(env(c, out, t, 0.9, 0.002, 0.05));
    tone(c, out, t + 0.06, 900, 0.04, 'square', 0.05);
  }),

  /** A totem breaks and saves a seat. */
  saved: () => play((c, out, t) => {
    tone(c, out, t + 0.08, 987.77, 0.35, 'triangle', 0.25);
    tone(c, out, t + 0.16, 1318.5, 0.5, 'triangle', 0.22);
  }),
};
