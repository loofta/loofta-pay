export type TierKey = 'peon' | 'hustler' | 'whale' | 'mogul' | 'legend';

export interface Tier {
  key: TierKey;
  label: string;
  minVolume: number;
  maxVolume: number | null;
  /** Tailwind text color class */
  color: string;
  /** Tailwind background class */
  bg: string;
}

export const TIERS: Tier[] = [
  { key: 'peon',    label: 'Peon',    minVolume: 0,       maxVolume: 1000,   color: 'text-slate-400',   bg: 'bg-slate-500/15'   },
  { key: 'hustler', label: 'Hustler', minVolume: 1000,    maxVolume: 50000,  color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  { key: 'whale',   label: 'Whale',   minVolume: 50000,   maxVolume: 100000, color: 'text-blue-400',    bg: 'bg-blue-500/15'    },
  { key: 'mogul',   label: 'Mogul',   minVolume: 100000,  maxVolume: 1000000,color: 'text-amber-400',   bg: 'bg-amber-500/15'   },
  { key: 'legend',  label: 'Legend',  minVolume: 1000000, maxVolume: null,   color: 'text-yellow-400',  bg: 'bg-yellow-500/15'  },
];

export function getTierForVolume(volumeUsd: number): Tier {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (volumeUsd >= TIERS[i].minVolume) return TIERS[i];
  }
  return TIERS[0];
}
