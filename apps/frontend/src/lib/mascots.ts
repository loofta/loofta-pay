// Static manifest for the 20 mascots at public/images/mascots/ (see that folder's README.md for
// the source sticker-sheet doc) — the gacha exclusion game's seat avatars. Keys match exactly
// what the backend's MASCOT_KEYS whitelist and gacha_room_participants.mascot_key CHECK
// constraint accept (apps/backend/src/modules/gacha/gacha.service.ts).

export interface Mascot {
  key: string;
  name: string;
  bit: string;
}

export const MASCOTS: Mascot[] = [
  { key: 'fox', name: 'BLAZE', bit: 'Aviators + flame. Too cool to blink.' },
  { key: 'octopus', name: 'DJ INK', bit: 'Backwards cap, winking. 8 arms, 1 drop.' },
  { key: 'pig', name: 'ROCKET', bit: 'Wings + gold halo. When pigs fly.' },
  { key: 'goat', name: 'GOAT', bit: 'Gold horns, rectangle pupils, medal. Obviously.' },
  { key: 'shark', name: 'CHOMP', bit: 'Dorsal fin, toothy grin. All smiles.' },
  { key: 'cat', name: 'ZAP', bit: 'Lightning-bolt eyes. Fully charged.' },
  { key: 'dog', name: 'BASS', bit: "Headphones on. Can't hear you." },
  { key: 'chick', name: 'CHAMP', bit: 'Gold crown, game face. Undefeated.' },
  { key: 'bunny', name: 'SWAG', bit: 'Pixel shades. Deal with it.' },
  { key: 'bear', name: 'STACKS', bit: 'Gold $ chain. Non-custodial.' },
  { key: 'hamster', name: 'TURBO', bit: 'Headband + speed lines. Built different.' },
  { key: 'penguin', name: 'SUAVE', bit: 'Red bowtie. Black tie only.' },
  { key: 'snail', name: 'NITRO', bit: '0 to 0.1 real quick.' },
  { key: 'crab', name: 'PINCH', bit: 'Angry brows + KO stars. Hands up.' },
  { key: 'sloth', name: 'SLOMO', bit: 'Half-lidded, mid-nap. Gas fees can wait.' },
  { key: 'duck', name: 'QUACK', bit: 'Flat bill, crossed eyes. No thoughts.' },
  { key: 'raccoon', name: 'DEGEN', bit: 'Bandit mask, wired stare. Up all night.' },
  { key: 'owl', name: 'AUDIT', bit: 'Giant spectacles. Sees everything.' },
  { key: 'axolotl', name: 'LIL GUY', bit: 'Pink gills, huge grin. Just happy to be here.' },
  { key: 'turtle', name: 'HODL', bit: 'Gold shell, unbothered.' },
];

const BY_KEY: Record<string, Mascot> = Object.fromEntries(MASCOTS.map((m) => [m.key, m]));

export function getMascot(key: string | null | undefined): Mascot | null {
  if (!key) return null;
  return BY_KEY[key] ?? null;
}

export function mascotImageSrc(key: string): string {
  return `/images/mascots/${key}.svg`;
}
