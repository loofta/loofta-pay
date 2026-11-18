import type { FeedParams, MemecoinDetail, MemecoinFeed, MemecoinItem, StoryCard } from "./memecoin";

/**
 * Local-only sample data so the terminal UI can be checked before real migrations are flowing.
 * Only reachable when NODE_ENV is "development" and the page is opened with ?fixture=1; the
 * import in memecoin.ts is dead code in a production build.
 */
const base = (o: Partial<MemecoinItem> & Pick<MemecoinItem, "mint" | "name" | "symbol">): MemecoinItem => ({
  imageUrl: null,
  status: "migrated",
  stage: { key: "grad", percent: 100 },
  ageMinutes: 180,
  fresh: false,
  mcapUsd: 412_000,
  volume24hUsd: 186_000,
  holders: 1240,
  priceChange1h: 4.5,
  dexPaid: true,
  liquidityLocked: true,
  risk: "low",
  passes: true,
  hiddenReason: null,
  website: "https://example.com",
  twitter: "https://x.com/example",
  telegram: null,
  ...o,
});

const ITEMS: MemecoinItem[] = [
  base({ mint: "FxBriot1111111111111111111111111111111111111", name: "Baguette Riot", symbol: "BRIOT", fresh: true, ageMinutes: 4 }),
  base({ mint: "FxLootr1111111111111111111111111111111111111", name: "Looter Cart", symbol: "LOOTR", mcapUsd: 1_200_000, volume24hUsd: 640_000, holders: 3110, ageMinutes: 540, risk: "med", liquidityLocked: false }),
  base({ mint: "FxPanda1111111111111111111111111111111111111", name: "Panda Sol", symbol: "PANDASOL", mcapUsd: 3_400_000, volume24hUsd: 1_100_000, holders: 6420, ageMinutes: 2880, priceChange1h: -12 }),
  base({ mint: "FxWcat11111111111111111111111111111111111111", name: "Wave Cat", symbol: "WCAT", mcapUsd: 880_000, volume24hUsd: 290_000, holders: 2210, ageMinutes: 1440, dexPaid: false }),
  base({ mint: "FxMari11111111111111111111111111111111111111", name: "Marianne", symbol: "MARI", mcapUsd: 58_000, volume24hUsd: 22_000, holders: 184, ageMinutes: 41, risk: "high", dexPaid: false, liquidityLocked: false }),
  base({ mint: "FxCrage1111111111111111111111111111111111111", name: "Croissant Rage", symbol: "CRAGE", mcapUsd: 9_000, volume24hUsd: 380, holders: 7, ageMinutes: 12, risk: "high", passes: false, hiddenReason: "low volume", dexPaid: false, liquidityLocked: false }),
  base({ mint: "FxShsol1111111111111111111111111111111111111", name: "Sol Shanghai", symbol: "SHSOL", mcapUsd: 14_000, volume24hUsd: 1_200, holders: 9, ageMinutes: 25, risk: "high", passes: false, hiddenReason: "too few holders", dexPaid: false, liquidityLocked: false, website: null, twitter: null }),
];

const STORY_MINTS: Record<string, string[]> = {
  france: ["FxBriot1111111111111111111111111111111111111", "FxLootr1111111111111111111111111111111111111", "FxMari11111111111111111111111111111111111111"],
  china: ["FxPanda1111111111111111111111111111111111111", "FxShsol1111111111111111111111111111111111111"],
};

export function fixtureStories(): { stories: StoryCard[]; generatedAt: string } {
  const top = (mints: string[]) => ITEMS.filter(i => mints.includes(i.mint)).map(i => ({ mint: i.mint, name: i.name, imageUrl: null }));
  return {
    generatedAt: new Date().toISOString(),
    stories: [
      { key: "france", label: "News and protest", kind: "theme", coinCount: 6, passingCount: 3, recentCount: 5, momentum: 2.5, volumeUsd: 700_000, heat: 31, explain: "6 coins about news and protest graduated in the last two days, 5 of them in the last day, and it is speeding up.", topCoins: top(STORY_MINTS.france) },
      { key: "china", label: "China and Asia", kind: "theme", coinCount: 4, passingCount: 1, recentCount: 1, momentum: 0.5, volumeUsd: 1_100_000, heat: 8, explain: "4 coins about china and asia graduated in the last two days, 1 of them in the last day, but it is slowing down.", topCoins: top(STORY_MINTS.china) },
    ],
  };
}

export function fixtureFeed(p: FeedParams): MemecoinFeed {
  const inStory = p.story ? STORY_MINTS[p.story] ?? [] : null;
  const items = ITEMS.filter(i => (!inStory || inStory.includes(i.mint)) && (!p.safe || i.passes) && (!p.lowRiskOnly || i.risk === "low") && (!p.stage || i.stage.key === p.stage));
  return { items, meta: { shown: items.length, passedTotal: ITEMS.filter(i => i.passes).length, launches24h: 18_420, hiddenToday: 18_415, generatedAt: new Date().toISOString() } };
}

export function fixtureDetail(mint: string): MemecoinDetail {
  const item = ITEMS.find(i => i.mint === mint) ?? ITEMS[0];
  const bad = !item.passes;
  return {
    ...item,
    bundlerPct: bad ? 38 : 6,
    devPct: bad ? 22 : 2,
    riskSummary: bad
      ? "This coin fails our basic checks. Insiders hold too much, nobody trades it, or the creator kept powers that can hurt holders. Coins like this are often rugs."
      : "Fewer warning signs than most: liquidity is locked and the Dex listing is paid, and insiders hold little. This is not safe. Meme coins can still drop to zero.",
    checks: [
      { status: bad ? "bad" : "good", title: bad ? "38% grabbed at launch" : "6% grabbed at launch", why: "Wallets working together bought this much in the first second. If they sell together, the price falls hard." },
      { status: bad ? "bad" : "good", title: bad ? "Creator holds 22%" : "Creator holds 2%", why: bad ? "The creator could sell and crash the price on their own." : "Small enough that the creator can't crash it alone." },
      { status: item.liquidityLocked ? "good" : "warn", title: item.liquidityLocked ? "Liquidity locked" : "Liquidity not locked", why: item.liquidityLocked ? "The money pool that makes trading possible can't be pulled out by the creator." : "The creator could pull the money pool. This is the classic rug." },
      { status: item.dexPaid ? "good" : "warn", title: item.dexPaid ? "Dex paid" : "Dex not paid", why: item.dexPaid ? "The team paid for a proper listing page. A small sign they plan to stay." : "No paid listing yet. Common for very new coins." },
      { status: bad ? "bad" : "good", title: `${(item.holders ?? 0).toLocaleString("en-US")} holders`, why: bad ? "Almost nobody holds it besides the creator." : "Real people own it, not just the creator." },
      { status: bad ? "bad" : "good", title: "Volume check", why: bad ? "Barely any trading. Hard to sell if you want out." : "People are actually buying and selling." },
    ],
  };
}
