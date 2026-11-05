// What a PoolRip chip-in or Death seat can return, computed from the $25 Starter pack's published odds
// (PoolRip GET /api/packs/odds): card value tiers, 85% instant buyback, and the flat $0.50 platform fee taken from the
// buyback before the pool is paid out. Keep in sync with PoolRip if the pack odds or fees change.
export const PACK_PRICE_USDC = 25;
const BUYBACK = 0.85;
const FEE_USDC = 0.5;
const DEATH_SEATS = 10;
/** Death mode ends after at most 5 vote-outs, so at best 5 of the 10 seats are left to split the sale. */
const MIN_SURVIVORS = 5;

export const PACK_TIERS = [
  { key: "common", label: "Common", chance: 0.75, min: 13, max: 30 },
  { key: "uncommon", label: "Uncommon", chance: 0.2, min: 30, max: 55 },
  { key: "rare", label: "Rare", chance: 0.04, min: 55, max: 125 },
  { key: "epic", label: "Epic", chance: 0.01, min: 125, max: 500 },
] as const;

const sale = (card: number) => Math.max(0, card * BUYBACK - FEE_USDC);
const topCard = PACK_TIERS[PACK_TIERS.length - 1].max;

/** Collab pool: what `amount` of the pack's price returns for a card worth `card`. */
export const collabReturn = (amount: number, card: number) => (amount / PACK_PRICE_USDC) * sale(card);
/** Best case multiple of the chip-in (epic card at its top value). */
export const collabMaxMultiple = () => collabReturn(1, topCard);
export const collabTierRange = (amount: number, tier: (typeof PACK_TIERS)[number]) => [collabReturn(amount, tier.min), collabReturn(amount, tier.max)] as const;
/** Worst case multiple of the chip-in (cheapest card at its floor value): you always get this much back. */
export const collabMinMultiple = () => collabReturn(1, PACK_TIERS[0].min);
/** Share of packs whose sale pays back more than the pool cost (card above ~$30). */
export const chanceAboveCost = () => PACK_TIERS.filter((t) => t.min >= 30).reduce((n, t) => n + t.chance, 0);

/** Death seat: best case is an epic card with only the minimum survivors left to split it, by equal stake. */
export const deathSeatBestCase = (seatUsdc: number) => (sale(topCard) / MIN_SURVIVORS) * ((seatUsdc * DEATH_SEATS) / PACK_PRICE_USDC);
