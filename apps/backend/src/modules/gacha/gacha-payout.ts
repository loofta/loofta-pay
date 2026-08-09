export interface GachaPayoutParticipant {
  id: string;
  seat_number: number;
  excluded: boolean;
}

/**
 * Allocates integer token units to surviving seats without losing dust. The first survivor by
 * seat number receives the remainder, so the result is deterministic and sums exactly to the
 * on-chain amount received by the treasury.
 */
export function calculateGachaPayoutUnits(
  participants: GachaPayoutParticipant[],
  totalUnits: bigint,
): Map<string, bigint> {
  if (totalUnits < 0n) throw new Error('Gacha payout total cannot be negative');
  const ordered = [...participants].sort((a, b) => a.seat_number - b.seat_number);
  const survivors = ordered.filter((participant) => !participant.excluded);
  if (!survivors.length) throw new Error('Gacha settlement requires at least one survivor');

  const share = totalUnits / BigInt(survivors.length);
  const dust = totalUnits - share * BigInt(survivors.length);
  const unitsByParticipant = new Map(ordered.map((participant) => [participant.id, 0n]));
  survivors.forEach((participant, index) => {
    unitsByParticipant.set(participant.id, share + (index === 0 ? dust : 0n));
  });
  return unitsByParticipant;
}
