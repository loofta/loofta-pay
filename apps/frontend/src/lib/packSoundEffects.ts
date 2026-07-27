// Lightweight sound effects for the Mystery Pack opening sequence — synthesized live via the Web
// Audio API (oscillators + noise + gain envelopes), no audio file assets to ship/host. The
// AudioContext is created/resumed lazily from inside getContext, but ONLY ever from within a real
// user gesture (a click/pointerdown), which is what every browser's autoplay policy requires
// before audio is allowed to play at all.
//
// Constructing `new AudioContext()` for the first time can itself cost real time on lower-end
// mobile devices/iOS (tens to hundreds of ms as the platform spins up its audio subsystem) — if
// that construction happens inside the exact click handler that also kicks off the pack's shake
// animation, it stalls the main thread right at that moment and reads as the whole interaction
// lagging. warmUpAudio() lets a caller pay that one-time cost earlier, on some prior harmless
// gesture (see MegapotPack's canvas pointerdown listener), so by the time a real sound effect is
// actually requested the context already exists and playing it is effectively instant.
let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Pays the one-time AudioContext construction cost ahead of the actual pack-open interaction —
 *  call from any earlier real user gesture. Safe to call repeatedly (cheap no-op once created). */
export function warmUpAudio(): void {
  getContext();
}

function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * seconds)), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function tone(
  context: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  opts: { type?: OscillatorType; gain?: number; sweepTo?: number } = {},
) {
  const osc = context.createOscillator();
  const gainNode = context.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, startAt);
  if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, startAt + duration);
  const peak = opts.gain ?? 0.2;
  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.linearRampToValueAtTime(peak, startAt + 0.012);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gainNode).connect(context.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** Played the instant the pack starts shaking (click-to-open) — a quick rattly flurry of soft
 *  ticks, like the foil pouch being shaken in hand. Also the one call responsible for actually
 *  creating/resuming the AudioContext, since this always fires directly inside a click handler. */
export function playShakeSound(muted: boolean): void {
  if (muted) return;
  const context = getContext();
  if (!context) return;
  const now = context.currentTime;
  for (let i = 0; i < 6; i++) {
    const t = now + i * 0.09 + Math.random() * 0.02;
    tone(context, 700 + Math.random() * 300, t, 0.05, { type: "square", gain: 0.05 });
  }
}

/** Played when the pack tears open — a filtered noise burst (paper tear) layered with a quick
 *  downward-pitched thump for punch. */
export function playBurstSound(muted: boolean): void {
  if (muted) return;
  const context = getContext();
  if (!context) return;
  const now = context.currentTime;

  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer(context, 0.25);
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.32, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  const filter = context.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 800;
  noise.connect(filter).connect(noiseGain).connect(context.destination);
  noise.start(now);
  noise.stop(now + 0.26);

  tone(context, 180, now, 0.22, { type: "sine", gain: 0.28, sweepTo: 60 });
}

// Richer arpeggio for rarer tiers — the same "bigger win, bigger fanfare" idea as the confetti
// recoloring in MegapotPack, just for the ear instead of the eye.
const RARITY_CHIME_NOTES: Record<string, number[]> = {
  common: [523.25, 659.25],
  uncommon: [523.25, 659.25, 783.99],
  rare: [523.25, 659.25, 783.99, 987.77],
  epic: [523.25, 659.25, 783.99, 987.77, 1318.51],
};

/** Played once the ticket has fully settled into view — a short ascending bell-like chime. */
export function playRevealChime(rarity: string, muted: boolean): void {
  if (muted) return;
  const context = getContext();
  if (!context) return;
  const now = context.currentTime;
  const notes = RARITY_CHIME_NOTES[rarity] ?? RARITY_CHIME_NOTES.common;
  notes.forEach((freq, i) => {
    tone(context, freq, now + i * 0.09, 0.5, { type: "triangle", gain: 0.16 });
  });
}
