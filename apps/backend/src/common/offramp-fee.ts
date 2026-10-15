/**
 * Fee on Venmo / Cash App / Revolut cash-outs: 2% of the gross USDC (never under $0.30), split evenly.
 * Half is Loofta's cut, taken as a USDC transfer to the fee payer ATA in the Solana bridge transaction.
 * The other half is the peer's fill incentive, applied as a negative oracle spread on the Base deposit.
 * Must stay in sync with apps/frontend/src/services/peerCash.ts.
 */
const MIN_FEE_ATOMIC = 300_000n;

export function cashoutFeeAtomic(grossAtomic: bigint): bigint {
  if (grossAtomic <= 0n) return 0n;
  const percent = (grossAtomic * 2n) / 100n;
  const fee = percent > MIN_FEE_ATOMIC ? percent : MIN_FEE_ATOMIC;
  return fee > grossAtomic ? grossAtomic : fee;
}

export function cashoutLooftaFeeAtomic(grossAtomic: bigint): bigint {
  return cashoutFeeAtomic(grossAtomic) / 2n;
}
