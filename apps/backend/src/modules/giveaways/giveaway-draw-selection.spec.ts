import { hashEntrySnapshot, selectRandomWinners, selectFirstComeWinners } from './giveaway-draw-selection';

describe('giveaway-draw-selection', () => {
  describe('hashEntrySnapshot', () => {
    it('is order-independent (sorts before hashing)', () => {
      expect(hashEntrySnapshot(['b', 'a', 'c'])).toBe(hashEntrySnapshot(['a', 'b', 'c']));
    });

    it('changes when the entry set changes', () => {
      expect(hashEntrySnapshot(['a', 'b'])).not.toBe(hashEntrySnapshot(['a', 'b', 'c']));
    });
  });

  describe('selectRandomWinners', () => {
    const entryIds = ['e1', 'e2', 'e3', 'e4', 'e5'];
    const seed = 'deadbeef'.repeat(8); // 32-byte hex

    it('is deterministic for a fixed seed and entry set', () => {
      const first = selectRandomWinners(entryIds, seed, 2);
      const second = selectRandomWinners(entryIds, seed, 2);
      expect(second).toEqual(first);
    });

    it('returns exactly winnerCount winners, all drawn from the entry set', () => {
      const winners = selectRandomWinners(entryIds, seed, 3);
      expect(winners).toHaveLength(3);
      for (const id of winners) expect(entryIds).toContain(id);
      expect(new Set(winners).size).toBe(3); // no duplicates
    });

    it('changes result when the seed changes', () => {
      const winnersA = selectRandomWinners(entryIds, seed, 2);
      const winnersB = selectRandomWinners(entryIds, 'a'.repeat(64), 2);
      expect(winnersB).not.toEqual(winnersA);
    });

    it('selects all entries (no error) when winnerCount exceeds the entry count', () => {
      const winners = selectRandomWinners(entryIds, seed, 10);
      expect(winners.sort()).toEqual([...entryIds].sort());
    });
  });

  describe('selectFirstComeWinners', () => {
    it('picks earliest completedAt regardless of entry order', () => {
      const entries = [
        { id: 'e1', entry_index: 1, completedAt: '2026-08-26T12:00:00Z' }, // entered first, finished last
        { id: 'e2', entry_index: 2, completedAt: '2026-08-26T10:00:00Z' },
        { id: 'e3', entry_index: 3, completedAt: '2026-08-26T09:00:00Z' }, // entered last, finished first
      ];
      expect(selectFirstComeWinners(entries, 2)).toEqual(['e3', 'e2']);
    });

    it('falls back to entry_index when completedAt is missing (e.g. a task-less giveaway)', () => {
      const entries = [
        { id: 'e3', entry_index: 3 },
        { id: 'e1', entry_index: 1 },
        { id: 'e2', entry_index: 2 },
      ];
      expect(selectFirstComeWinners(entries, 2)).toEqual(['e1', 'e2']);
    });

    it('ranks any entry with a completedAt above one without', () => {
      const entries = [
        { id: 'e1', entry_index: 1, completedAt: null },
        { id: 'e2', entry_index: 2, completedAt: '2026-08-26T10:00:00Z' },
      ];
      expect(selectFirstComeWinners(entries, 1)).toEqual(['e2']);
    });

    it('selects all entries when winnerCount exceeds the entry count', () => {
      const entries = [
        { id: 'e1', entry_index: 1, completedAt: '2026-08-26T10:00:00Z' },
        { id: 'e2', entry_index: 2, completedAt: '2026-08-26T11:00:00Z' },
      ];
      expect(selectFirstComeWinners(entries, 5)).toEqual(['e1', 'e2']);
    });
  });
});
