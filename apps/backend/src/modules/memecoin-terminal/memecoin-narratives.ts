/**
 * Narrative ("story") detection for migrated coins. Pure code, no network and no LLM: the grouping
 * and the heat score are rules, so they can be backtested and never change by mood. A model is only
 * allowed to word the explanation of a cluster afterwards.
 *
 * A coin is placed in a story in two ways:
 *  1. A curated theme list (dogs, cats, politics, ...) matches words in its name, symbol or description.
 *  2. Otherwise, a word that shows up in the names of several different coins at once (an emerging
 *     theme nobody listed yet) groups them together.
 */

export interface NarrativeCoin {
  mint: string;
  name: string | null;
  symbol: string | null;
  description?: string | null;
  /** Epoch ms the coin graduated (or its pool was created). */
  migratedAt: number;
  volume24hUsd: number | null;
}

export interface Story {
  key: string;
  label: string;
  kind: 'theme' | 'emerging';
  coins: string[];
  coinCount: number;
  volumeUsd: number;
  /** Coins that graduated in the recent window (default last 24h). */
  recentCount: number;
  /** recentCount compared to the coins of the window before it; above 1 means it is speeding up. */
  momentum: number;
  heat: number;
}

/** theme key -> label + words. A word matches a whole token, or the start of one for the stems ending in `*`. */
export const THEMES: Record<string, { label: string; words: string[] }> = {
  dogs: { label: 'Dogs', words: ['dog', 'dogs', 'doge', 'dogg', 'puppy', 'pup', 'shiba', 'shib', 'inu', 'wif', 'bonk', 'corgi', 'husky', 'pitbull', 'woof', 'bark', 'cheems'] },
  cats: { label: 'Cats', words: ['cat', 'cats', 'kitty', 'kitten', 'meow', 'neko', 'popcat', 'mew', 'purr', 'tabby', 'nyan'] },
  frogs: { label: 'Frogs', words: ['frog', 'frogs', 'pepe', 'toad', 'ribbit', 'kermit'] },
  politics: { label: 'Politics and leaders', words: ['trump', 'maga', 'biden', 'harris', 'elon', 'musk', 'putin', 'vote', 'election', 'president', 'senate', 'congress', 'macron', 'milei', 'kamala'] },
  ai: { label: 'AI', words: ['ai', 'gpt', 'agent', 'agents', 'bot', 'robot', 'neural', 'claude', 'grok', 'llm', 'chatgpt', 'openai', 'sentient'] },
  anime: { label: 'Anime and games', words: ['anime', 'waifu', 'otaku', 'naruto', 'goku', 'pokemon', 'pikachu', 'mario', 'zelda', 'minecraft', 'roblox', 'kawaii', 'senpai'] },
  food: { label: 'Food', words: ['pizza', 'burger', 'taco', 'sushi', 'ramen', 'cheese', 'bacon', 'noodle', 'noodles', 'coffee', 'beer', 'wine', 'croissant', 'baguette', 'donut', 'cookie', 'banana', 'potato', 'egg'] },
  animals: { label: 'Other animals', words: ['panda', 'bear', 'bull', 'monkey', 'ape', 'apes', 'chimp', 'penguin', 'duck', 'bird', 'owl', 'fish', 'whale', 'shark', 'rat', 'mouse', 'hamster', 'capybara', 'goat', 'pig', 'cow', 'fox', 'wolf', 'lion', 'tiger', 'bunny', 'rabbit', 'turtle', 'dragon', 'hippo', 'moo'] },
  celeb: { label: 'Celebrities and creators', words: ['kanye', 'ye', 'drake', 'taylor', 'swift', 'messi', 'ronaldo', 'mrbeast', 'beast', 'tate', 'logan', 'paul', 'snoop', 'diddy'] },
  space: { label: 'Space and sci-fi', words: ['moon', 'mars', 'rocket', 'space', 'alien', 'aliens', 'ufo', 'galaxy', 'star', 'cosmic', 'astro', 'saturn'] },
  china: { label: 'China and Asia', words: ['china', 'chinese', 'panda', 'shanghai', 'beijing', 'dragon', 'yuan', 'asia', 'japan', 'korea', 'kimchi', 'tokyo', 'seoul', 'hk'] },
  stocks: { label: 'Stocks and brands', words: ['tesla', 'nvidia', 'apple', 'amazon', 'google', 'meta', 'stock', 'stocks', 'nasdaq', 'spy', 'tsla', 'nvda', 'robinhood', 'coinbase', 'nike', 'mcdonalds'] },
  riot: { label: 'News and protest', words: ['riot', 'riots', 'protest', 'strike', 'war', 'looter', 'looters', 'looting', 'revolution', 'ice', 'tariff', 'tariffs', 'ban', 'leak'] },
  money: { label: 'Money and degen life', words: ['rich', 'millionaire', 'billion', 'gold', 'diamond', 'cash', 'bank', 'broke', 'rug', 'rugged', 'ponzi', 'degen', 'gm', 'wagmi', 'ngmi', 'fomo', 'jeet', 'pump'] },
};

const STOPWORDS = new Set([
  'the', 'of', 'and', 'for', 'with', 'from', 'this', 'that', 'you', 'your', 'are', 'was', 'not', 'but', 'all', 'can', 'its', 'new', 'one', 'any', 'out',
  'coin', 'token', 'coins', 'tokens', 'sol', 'solana', 'meme', 'memecoin', 'crypto', 'pump', 'pumpfun', 'fun', 'official', 'finance', 'protocol', 'network',
  'swap', 'dao', 'club', 'inc', 'ltd', 'labs', 'lab', 'life', 'world', 'cash', 'coin', 'based', 'the', 'real', 'first', 'big', 'mini', 'baby', 'super', 'mega',
  'ultra', 'on', 'in', 'to', 'is', 'it', 'of', 'my', 'we', 'me', 'by', 'at', 'as', 'an', 'be', 'so', 'do', 'go', 'no', 'up',
]);

/** Splits `BabyDogeCoin` / `looter-cart` / `Panda$Sol` into lowercase word pieces. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  const spaced = text.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
}

const WORD_TO_THEMES: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [key, t] of Object.entries(THEMES)) {
    for (const w of t.words) m.set(w, [...(m.get(w) ?? []), key]);
  }
  return m;
})();

/** Theme keys a coin matches, strongest first (name words count double the description's). */
export function themesOf(coin: Pick<NarrativeCoin, 'name' | 'symbol' | 'description'>): string[] {
  const score = new Map<string, number>();
  const add = (words: string[], weight: number) => {
    for (const w of words) for (const key of WORD_TO_THEMES.get(w) ?? []) score.set(key, (score.get(key) ?? 0) + weight);
  };
  add(tokenize(coin.name), 2);
  add(tokenize(coin.symbol), 2);
  add(tokenize(coin.description).slice(0, 60), 1);
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** Meaningful words of a name that could form an emerging theme. */
function emergingWords(coin: NarrativeCoin): string[] {
  return [...new Set([...tokenize(coin.name), ...tokenize(coin.symbol)])].filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w) && !WORD_TO_THEMES.has(w),
  );
}

export interface ClusterOptions {
  now: number;
  /** "Recent" window for momentum, default 24h. */
  windowMs?: number;
  /** Fewest coins for a group to count as a story, default 3. */
  minCoins?: number;
  /** An emerging word must appear in this many different coins, default 3. */
  minEmerging?: number;
  limit?: number;
}

const HOUR = 3_600_000;

/**
 * Groups coins into stories and ranks them by heat. Every coin lands in at most one story: its
 * strongest curated theme, otherwise the emerging word shared by the most coins.
 */
export function clusterNarratives(coins: NarrativeCoin[], opts: ClusterOptions): Story[] {
  const windowMs = opts.windowMs ?? 24 * HOUR;
  const minCoins = opts.minCoins ?? 3;
  const minEmerging = opts.minEmerging ?? 3;

  const groups = new Map<string, { label: string; kind: 'theme' | 'emerging'; coins: NarrativeCoin[] }>();
  const loose: NarrativeCoin[] = [];
  for (const c of coins) {
    const [top] = themesOf(c);
    if (top) {
      const g = groups.get(top) ?? { label: THEMES[top].label, kind: 'theme' as const, coins: [] };
      g.coins.push(c);
      groups.set(top, g);
    } else loose.push(c);
  }

  // Emerging: a word in >= minEmerging loose coins. Biggest word first; a coin joins only one.
  const byWord = new Map<string, NarrativeCoin[]>();
  for (const c of loose) for (const w of emergingWords(c)) byWord.set(w, [...(byWord.get(w) ?? []), c]);
  const taken = new Set<string>();
  for (const [word, list] of [...byWord.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const free = list.filter((c) => !taken.has(c.mint));
    if (free.length < minEmerging) continue;
    for (const c of free) taken.add(c.mint);
    groups.set(`word:${word}`, { label: word.charAt(0).toUpperCase() + word.slice(1), kind: 'emerging', coins: free });
  }

  const stories: Story[] = [];
  for (const [key, g] of groups) {
    if (g.coins.length < minCoins) continue;
    const recent = g.coins.filter((c) => opts.now - c.migratedAt <= windowMs).length;
    const before = g.coins.filter((c) => opts.now - c.migratedAt > windowMs && opts.now - c.migratedAt <= 2 * windowMs).length;
    const momentum = (recent + 1) / (before + 1);
    const volumeUsd = g.coins.reduce((s, c) => s + (c.volume24hUsd ?? 0), 0);
    // Heat: how many coins are riding it now, how fast it is growing, and a log of the money in it.
    const heat = recent * Math.min(momentum, 4) * Math.log10(10 + volumeUsd);
    stories.push({
      key,
      label: g.label,
      kind: g.kind,
      coins: g.coins.map((c) => c.mint).sort(),
      coinCount: g.coins.length,
      volumeUsd,
      recentCount: recent,
      momentum,
      heat,
    });
  }
  return stories.sort((a, b) => b.heat - a.heat).slice(0, opts.limit ?? 8);
}
