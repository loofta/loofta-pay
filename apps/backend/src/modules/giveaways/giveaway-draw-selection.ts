import { createHash } from 'crypto';

/**
 * Pure, dependency-free winner-selection functions — deliberately isolated from any DB/network
 * I/O so they're trivially unit-testable (fixed inputs -> deterministic output) and so the
 * "anyone can independently recompute and confirm the winners" audit claim actually holds: the
 * same randomness + entry list published on the public giveaway page reproduces this exact
 * result outside this codebase, in any language.
 */

export function hashEntrySnapshot(entryIds: string[]): string {
  const sorted = [...entryIds].sort();
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * key = sha256(randomnessHex + ':' + entryId), sort ascending, take the first `winnerCount`.
 * `randomnessHex` is `crypto.randomBytes(32).toString('hex')` for V1 (off-chain) —
 * // TODO(vrf): replace the randomness source with a MagicBlock VRF callback output once built;
 * this function's contract (any 32-byte hex seed in, deterministic winners out) does not change.
 */
export function selectRandomWinners(entryIds: string[], randomnessHex: string, winnerCount: number): string[] {
  const keyed = entryIds.map((id) => ({
    id,
    key: createHash('sha256').update(`${randomnessHex}:${id}`).digest('hex'),
  }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.slice(0, winnerCount).map((k) => k.id);
}

/** First-come-first-serve: lowest entry_index wins, ties broken by id (entry_index is unique per giveaway so ties shouldn't occur, but keep selection total/deterministic regardless). */
export function selectFirstComeWinners(entries: Array<{ id: string; entry_index: number }>, winnerCount: number): string[] {
  return [...entries]
    .sort((a, b) => (a.entry_index !== b.entry_index ? a.entry_index - b.entry_index : a.id.localeCompare(b.id)))
    .slice(0, winnerCount)
    .map((e) => e.id);
}
