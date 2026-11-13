import { clusterNarratives, NarrativeCoin, themesOf, tokenize } from './memecoin-narratives';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const H = 3_600_000;
const coin = (mint: string, name: string, hoursAgo: number, vol = 1000): NarrativeCoin => ({
  mint, name, symbol: null, migratedAt: NOW - hoursAgo * H, volume24hUsd: vol,
});

describe('tokenize', () => {
  it('splits camel case, symbols and numbers', () => {
    expect(tokenize('BabyDogeCoin')).toEqual(['baby', 'doge', 'coin']);
    expect(tokenize('looter-cart $2')).toEqual(['looter', 'cart']);
    expect(tokenize(null)).toEqual([]);
  });
});

describe('themesOf', () => {
  it('matches a curated theme from the name', () => {
    expect(themesOf({ name: 'Panda Sol', symbol: null })).toContain('animals');
    expect(themesOf({ name: 'Wave Cat', symbol: null })[0]).toBe('cats');
  });
  it('lets the name outweigh the description', () => {
    expect(themesOf({ name: 'Cat', symbol: null, description: 'not a dog' })[0]).toBe('cats');
  });
  it('returns nothing for an unknown name', () => {
    expect(themesOf({ name: 'Zorblax', symbol: null })).toEqual([]);
  });
});

describe('clusterNarratives', () => {
  it('groups coins of one theme and ranks it', () => {
    const coins = [
      coin('a', 'Wave Cat', 2), coin('b', 'Neko Sol', 5), coin('c', 'Kitty Pump', 9),
      coin('d', 'Doge Riot', 3),
    ];
    const stories = clusterNarratives(coins, { now: NOW });
    expect(stories).toHaveLength(1);
    expect(stories[0].label).toBe('Cats');
    expect(stories[0].coinCount).toBe(3);
  });

  it('drops groups below the minimum coin count', () => {
    expect(clusterNarratives([coin('a', 'Wave Cat', 1), coin('b', 'Neko', 2)], { now: NOW })).toEqual([]);
  });

  it('finds an emerging theme nobody listed', () => {
    const coins = [coin('a', 'Zorblax One', 1), coin('b', 'Zorblax Two', 2), coin('c', 'Zorblax Three', 3), coin('d', 'Unrelated Thing', 1)];
    const [story] = clusterNarratives(coins, { now: NOW });
    expect(story.kind).toBe('emerging');
    expect(story.label).toBe('Zorblax');
    expect(story.coinCount).toBe(3);
  });

  it('puts every coin in at most one story', () => {
    const coins = [
      coin('a', 'Zorblax Quux', 1), coin('b', 'Zorblax Quux', 2), coin('c', 'Zorblax Quux', 3),
    ];
    const total = clusterNarratives(coins, { now: NOW }).reduce((s, x) => s + x.coinCount, 0);
    expect(total).toBe(3);
  });

  it('scores a speeding-up story above a fading one', () => {
    const rising = [coin('a', 'Cat A', 1), coin('b', 'Cat B', 2), coin('c', 'Cat C', 3), coin('d', 'Cat D', 4), coin('e', 'Cat E', 30)];
    const fading = [coin('f', 'Frog A', 1), coin('g', 'Frog B', 26), coin('h', 'Frog C', 27), coin('i', 'Frog D', 28), coin('j', 'Frog E', 29)];
    const stories = clusterNarratives([...rising, ...fading], { now: NOW });
    expect(stories[0].label).toBe('Cats');
    expect(stories[0].momentum).toBeGreaterThan(stories[1].momentum);
  });

  it('is deterministic for the same input', () => {
    const coins = [coin('a', 'Cat A', 1), coin('b', 'Cat B', 2), coin('c', 'Cat C', 3)];
    expect(clusterNarratives(coins, { now: NOW })).toEqual(clusterNarratives([...coins].reverse(), { now: NOW }));
  });
});
