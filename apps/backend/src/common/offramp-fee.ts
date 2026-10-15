/**
 * Fee on Venmo / Cash App / Revolut cash-outs: 2% of the gross USDC, never under $0.10. The peer always gets a
 * 1% (1 : 0.99) rate on the Base deposit; Loofta keeps the rest, taken as a USDC transfer to the fee payer ATA
 * in the Solana bridge transaction. Must stay in sync with apps/frontend/src/services/peerCash.ts.
 */
const MIN_FEE_ATOMIC = 100_000n;

export function cashoutFeeAtomic(grossAtomic: bigint): bigint {
  if (grossAtomic <= 0n) return 0n;
  const percent = (grossAtomic * 2n) / 100n;
  const fee = percent > MIN_FEE_ATOMIC ? percent : MIN_FEE_ATOMIC;
  return fee > grossAtomic ? grossAtomic : fee;
}

/** Base deposit size: the peer's 1% spread then leaves exactly gross minus the total fee. */
export function cashoutDepositAtomic(grossAtomic: bigint): bigint {
  if (grossAtomic <= 0n) return 0n;
  const payout = grossAtomic - cashoutFeeAtomic(grossAtomic);
  const deposit = (payout * 10_000n + 9_899n) / 9_900n;
  return deposit > grossAtomic ? grossAtomic : deposit;
}

export function cashoutLooftaFeeAtomic(grossAtomic: bigint): bigint {
  return grossAtomic - cashoutDepositAtomic(grossAtomic);
}
