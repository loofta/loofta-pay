// Mascot metadata (name + flavor text) for the gacha exclusion game's seat avatars. The actual
// art now comes from the animated <Mascot> component (mascots-data.ts + Mascot.tsx, ported from
// react-mascots/) — this file is just the name/bit lookup layered on top of MASCOT_NAMES. Keys
// match exactly what the backend's MASCOT_KEYS whitelist and gacha_room_participants.mascot_key
// CHECK constraint accept (apps/backend/src/modules/gacha/gacha.service.ts).

import { MASCOT_LABELS } from './mascots-data';

export interface Mascot {
  key: string;
  name: string;
  bit: string;
}

const BIT: Record<string, string> = {
  fox: 'Aviators + flame. Too cool to blink.',
  octopus: 'Backwards cap, winking. 8 arms, 1 drop.',
  pig: 'Wings + gold halo. When pigs fly.',
  goat: 'Gold horns, rectangle pupils, medal. Obviously.',
  shark: 'Dorsal fin, toothy grin. All smiles.',
  cat: 'Lightning-bolt eyes. Fully charged.',
  dog: "Headphones on. Can't hear you.",
  chick: 'Gold crown, game face. Undefeated.',
  bunny: 'Pixel shades. Deal with it.',
  bear: 'Gold $ chain. Non-custodial.',
  hamster: 'Headband + speed lines. Built different.',
  penguin: 'Red bowtie. Black tie only.',
  snail: '0 to 0.1 real quick.',
  crab: 'Angry brows + KO stars. Hands up.',
  sloth: 'Half-lidded, mid-nap. Gas fees can wait.',
  duck: 'Flat bill, crossed eyes. No thoughts.',
  raccoon: 'Bandit mask, wired stare. Up all night.',
  owl: 'Giant spectacles. Sees everything.',
  axolotl: 'Pink gills, huge grin. Just happy to be here.',
  turtle: 'Gold shell, unbothered.',
};

export const MASCOTS: Mascot[] = Object.entries(MASCOT_LABELS).map(([key, name]) => ({
  key,
  name,
  bit: BIT[key] ?? '',
}));

const BY_KEY: Record<string, Mascot> = Object.fromEntries(MASCOTS.map((m) => [m.key, m]));

export function getMascot(key: string | null | undefined): Mascot | null {
  if (!key) return null;
  return BY_KEY[key] ?? null;
}
