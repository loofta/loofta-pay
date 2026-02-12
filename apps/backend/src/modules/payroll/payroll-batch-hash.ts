import * as crypto from 'crypto';

/**
 * Compute a single commitment hash for a payroll batch.
 * No amounts are exposed on-chain — only this hash is stored in the Receipt Logger.
 * Leaf = H(entry_id || recipient || amount); batch_hash = H(sorted leaves).
 */
export function computeBatchHash(
  entries: Array<{ id: string; recipient_address: string; amount: string }>,
): string {
  const leaves = entries
    .map((e) =>
      crypto
        .createHash('sha256')
        .update(
          [e.id, (e.recipient_address || '').trim().toLowerCase(), (e.amount || '').trim()].join('|'),
        )
        .digest('hex'),
    )
    .sort();
  return crypto.createHash('sha256').update(leaves.join('')).digest('hex');
}

/**
 * Hash of execution tx refs (for receipt). No raw tx ids on-chain if you want extra privacy.
 */
export function computeTxRefsHash(txHashes: string[]): string {
  const normalized = txHashes
    .filter(Boolean)
    .map((h) => h.trim().toLowerCase())
    .sort();
  return crypto.createHash('sha256').update(normalized.join('|')).digest('hex');
}
