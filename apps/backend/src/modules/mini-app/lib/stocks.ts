/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
/**
 * Every tokenized stock and ETF that can really be traded on Jupiter.
 *
 * The full list comes from three places, because no single source has them all:
 *  - Backed Finance's public catalog (xStocks): about 1,500 listed assets, each with its Solana address.
 *  - Backpack Securities tokens (SpaceX, SK Hynix and others), whose addresses are listed below.
 *  - Backpack Securities, PreStocks (pre-IPO companies like Anthropic and OpenAI) and Ondo tokenized
 *    stocks. Jupiter can only search these by name, 20 results at a time, so they are discovered once
 *    with a list of company names and remembered for 12 hours.
 * Jupiter then supplies price, picture and liquidity, and anything with almost no liquidity is dropped,
 * because a listed token nobody trades is not something to offer.
 */

const BACKED = "https://api.backed.fi/api/v2/public/assets";
const JUP = "https://api.jup.ag/tokens/v2/search";
const MIN_LIQUIDITY_USD = 3_000;
const CATALOG_TTL = 6 * 3_600_000;
const LIST_TTL = 30 * 60_000;

/** Backpack Securities tokens. Same addresses the Nest backend uses, each checked against Jupiter. */
const BACKPACK_MINTS = [
  "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb",
  "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1",
  "SNDKbwMUQvZhnLnxLduradgLHG5KrPuKwpnrkkGRhfH",
  "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg",
  "SKHYhSjuRWHgikq8eRKbtBbpABgJSkd7ytQV14i9EQ3",
  "DRAMjSWR7HRfJKjRkvQWYL2bcaejaVhuxEcjf4pAY4Cw",
];

export interface StockToken {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number;
  usd: number | null;
  mcap: number | null;
  change24h: number | null;
  liquidity: number;
  kind: "xstock" | "backpack" | "prestock" | "ondo";
}

interface JupToken {
  id: string;
  symbol: string;
  name: string;
  icon?: string;
  decimals: number;
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  isVerified?: boolean;
  stats24h?: { priceChange?: number };
}

/** One entry per family Jupiter can only search by name. Seeds are company names, each probed as "<seed> <family>". */
const FAMILIES: Array<{ name: string; kind: StockToken["kind"]; pattern: RegExp; seeds: string[] }> = [
  {
    name: "Backpack Securities",
    kind: "backpack",
    pattern: /Backpack Securities/i,
    seeds: ["Nvidia", "AMD", "Apple", "Microsoft", "Tesla", "Amazon", "Alphabet", "Meta", "Netflix", "Broadcom", "Micron", "Intel", "Qualcomm", "Nike", "Disney", "Coinbase", "Circle", "Robinhood", "Palantir", "Uber", "Boeing", "Visa", "Mastercard", "JPMorgan", "Walmart", "Costco", "Coca-Cola", "McDonald", "Exxon", "Pfizer", "Eli Lilly", "Oracle", "Salesforce", "SK Hynix", "Samsung", "TSMC", "Alibaba", "Monster", "TKO", "Take-Two", "Invesco QQQ", "SPDR", "Vanguard", "iShares", "ARK", "Sandisk", "Roundhill", "MicroStrategy", "Strategy", "GameStop"],
  },
  {
    name: "PreStocks",
    kind: "prestock",
    pattern: /PreStocks?/i,
    seeds: ["Anthropic", "OpenAI", "SpaceX", "Polymarket", "Neuralink", "Anduril", "Kalshi", "Figure AI", "xAI", "Stripe", "Databricks", "Ramp", "Perplexity", "Scale AI", "Cerebras", "Discord", "Canva", "Revolut", "Shein", "ByteDance", "Epic Games", "Waymo", "Ripple", "Kraken", "Plaid", "Chime", "Klarna", "Mistral", "Safe Superintelligence", "Thinking Machines", "Cursor", "Hyperliquid", "Starlink", "Boring Company"],
  },
  {
    name: "Ondo Tokenized",
    kind: "ondo",
    pattern: /Ondo Tokenized/i,
    seeds: ["NVIDIA", "Tesla", "Apple", "Microsoft", "Amazon", "Alphabet", "Meta", "Coinbase", "Circle", "Robinhood", "Palantir", "Netflix", "AMD", "Broadcom", "Oracle", "Nebius", "Alibaba", "iShares", "Invesco QQQ", "SPDR", "Vanguard", "Gold", "Silver", "Oil"],
  },
];
const FAMILY_TTL = 12 * 3_600_000;
/** Bump when the rules for what counts as a stock change, so a list built under the old rules is rebuilt. */
const LIST_VERSION = 2;

const g = globalThis as unknown as { __stocks?: { catalog: { at: number; mints: string[] } | null;
    families: { at: number; kinds: Map<string, StockToken["kind"]> } | null;
    discovering: boolean; list: { at: number; items: StockToken[]; v?: number } | null; running: Promise<void> | null } };
const store = (g.__stocks ??= { catalog: null, families: null, discovering: false, list: null, running: null });

function jupHeaders(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY ?? process.env.NEXT_PUBLIC_JUPITER_API_KEY;
  return key ? { "x-api-key": key } : {};
}

async function loadCatalog(): Promise<string[]> {
  if (store.catalog && Date.now() - store.catalog.at < CATALOG_TTL) return store.catalog.mints;
  const mints: string[] = [];
  // Pages are fetched five at a time. One by one this took more than 20 seconds.
  for (let first = 0; first < 30; first += 5) {
    const group = await Promise.all(
      Array.from({ length: 5 }, (_, k) =>
        fetch(`${BACKED}?page=${first + k}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    );
    let any = false;
    for (const j of group as Array<{ nodes?: Array<{ deployments?: Array<{ network?: string; address?: string }> }> } | null>) {
      for (const n of j?.nodes ?? []) {
        any = true;
        const sol = n.deployments?.find((d) => d.network === "Solana")?.address;
        if (sol) mints.push(sol);
      }
    }
    if (!any) break;
  }
  if (mints.length > 0) store.catalog = { at: Date.now(), mints };
  return mints;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Jupiter's gateway rate limits bursts even with a key, so batches are spaced out and a 429 is retried once. */
async function jupBatch(mints: string[]): Promise<JupToken[]> {
  const out: JupToken[] = [];
  for (let i = 0; i < mints.length; i += 100) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${JUP}?query=${mints.slice(i, i + 100).join(",")}`, { headers: jupHeaders(), signal: AbortSignal.timeout(10_000), cache: "no-store" });
        if (res.ok) {
          out.push(...((await res.json()) as JupToken[]));
          break;
        }
        if (res.status !== 429) break;
        await sleep(3_000);
      } catch {
        break;
      }
    }
    await sleep(1_200);
  }
  return out;
}

/**
 * Finds the Backpack, PreStocks and Ondo tokens by probing Jupiter's search with company names, one
 * at a time and spaced out. It takes a couple of minutes, runs in the background, and is repeated
 * every 12 hours. When it finishes, the stock list is marked stale so the next request rebuilds it.
 */
async function discoverFamilies(): Promise<void> {
  if (store.discovering) return;
  store.discovering = true;
  const kinds = new Map<string, StockToken["kind"]>();
  try {
    for (const fam of FAMILIES) {
      for (const q of [fam.name, ...fam.seeds.map((x) => `${x} ${fam.name}`)]) {
        try {
          const res = await fetch(`${JUP}?query=${encodeURIComponent(q)}`, { headers: jupHeaders(), signal: AbortSignal.timeout(10_000), cache: "no-store" });
          if (res.ok) for (const t of (await res.json()) as JupToken[]) if (fam.pattern.test(t.name)) kinds.set(t.id, fam.kind);
          else if (res.status === 429) await sleep(3_000);
        } catch {
          /* one failed probe only means a name may be missed this round */
        }
        await sleep(1_200);
      }
      // Publish after each family, so results appear as they are found.
      store.families = { at: Date.now(), kinds: new Map(kinds) };
      if (store.list) store.list = { ...store.list, at: 0 };
    }
  } finally {
    store.discovering = false;
  }
}

async function build(): Promise<StockToken[]> {
  const backed = await loadCatalog().catch(() => [] as string[]);
  const mints = [...new Set([...backed, ...BACKPACK_MINTS])];
  const kindOf = new Map<string, StockToken["kind"]>();
  for (const m of backed) kindOf.set(m, "xstock");
  for (const m of BACKPACK_MINTS) kindOf.set(m, "backpack");
  // Tokens found by name: Backpack, PreStocks and Ondo.
  for (const [m, k] of store.families?.kinds ?? []) {
    if (!kindOf.has(m)) mints.push(m);
    kindOf.set(m, k);
  }

  const known = await jupBatch([...new Set(mints)]);
  const ondo: JupToken[] = [];

  const seen = new Set<string>();
  const items: StockToken[] = [];
  for (const t of [...known, ...ondo]) {
    if (seen.has(t.id) || !kindOf.has(t.id) || (t.liquidity ?? 0) < MIN_LIQUIDITY_USD) continue;
    // Anyone can mint a token called "OpenAI". Tokens found by name must be verified by Jupiter, and the real
    // PreStocks addresses start with "Pre". Backed's catalog and the Backpack list are fixed, trusted addresses.
    const kind = kindOf.get(t.id)!;
    if (kind !== "xstock" && !BACKPACK_MINTS.includes(t.id) && !t.isVerified) continue;
    if (kind === "prestock" && !t.id.startsWith("Pre")) continue;
    if (!(t.usdPrice && t.usdPrice > 0)) continue;
    seen.add(t.id);
    items.push({
      mint: t.id,
      symbol: t.symbol,
      name: t.name.replace(/ xStock$/i, "").replace(/ PreStocks?$/i, "").replace(/ - Backpack Securities$/i, "").replace(/\s*\(Ondo Tokenized[^)]*\)\s*$/i, ""),
      icon: t.icon ?? null,
      decimals: t.decimals,
      usd: t.usdPrice ?? null,
      mcap: t.mcap ?? null,
      change24h: t.stats24h?.priceChange ?? null,
      liquidity: t.liquidity ?? 0,
      kind: kindOf.get(t.id)!,
    });
  }
  // Most traded first, so the names people know are at the top.
  return items.sort((a, b) => b.liquidity - a.liquidity);
}

/**
 * The stock list. Served from memory and rebuilt in the background once it is 30 minutes old. The
 * first build takes about half a minute, so with `wait: false` a caller gets an empty list and
 * `building: true` straight away instead of hanging.
 */
export async function getStocks(opts: { wait?: boolean } = { wait: true }): Promise<{ items: StockToken[]; building: boolean }> {
  // A thin list means a batch failed (rate limit), so it is retried after a minute instead of being kept for 30.
  const fresh = store.list && store.list.v === LIST_VERSION && Date.now() - store.list.at < (store.list.items.length >= 15 ? LIST_TTL : 60_000);
  if (!fresh && !store.running) {
    store.running = build()
      .then((items) => {
        if (items.length > 0) store.list = { at: Date.now(), items, v: LIST_VERSION };
      })
      .catch(() => {})
      .finally(() => {
        store.running = null;
      });
  }
  if ((!store.families || Date.now() - store.families.at > FAMILY_TTL) && !store.discovering) void discoverFamilies();
  if (!store.list && opts.wait !== false) await store.running;
  const list = store.list as { items: StockToken[] } | null;
  return { items: list?.items ?? [], building: !list };
}

/** Addresses of every stock we know, so other lists (like trending coins) can leave them out. */
export function knownStockMints(): Set<string> {
  const s = new Set<string>(BACKPACK_MINTS);
  for (const m of store.catalog?.mints ?? []) s.add(m);
  for (const t of store.list?.items ?? []) s.add(t.mint);
  return s;
}

/** Name patterns that mark a tokenized stock even before the catalog has loaded. */
export const STOCK_NAME = /(\bxStock\b|Backpack Securities|Ondo Tokenized|PreStocks?)/i;
