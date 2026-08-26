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

/** First-come-first-serve: earliest `completedAt` (when the entry's last task was verified) wins —
 *  this is what "first come" means for a task-gated giveaway: first to finish, not first to click
 *  Enter. Every winner candidate already has every task verified (see getEligibleVerifiedEntries),
 *  so completedAt is only missing for a giveaway with zero tasks, where entry_index (enter order)
 *  is the only meaningful signal — kept as the tiebreak/fallback for that case, id as a last resort. */
export function selectFirstComeWinners(
  entries: Array<{ id: string; entry_index: number; completedAt?: string | null }>,
  winnerCount: number,
): string[] {
  return [...entries]
    .sort((a, b) => {
      const at = a.completedAt ? new Date(a.completedAt).getTime() : null;
      const bt = b.completedAt ? new Date(b.completedAt).getTime() : null;
      if (at !== null && bt !== null && at !== bt) return at - bt;
      if (at !== null && bt === null) return -1;
      if (at === null && bt !== null) return 1;
      return a.entry_index !== b.entry_index ? a.entry_index - b.entry_index : a.id.localeCompare(b.id);
    })
    .slice(0, winnerCount)
    .map((e) => e.id);
}
