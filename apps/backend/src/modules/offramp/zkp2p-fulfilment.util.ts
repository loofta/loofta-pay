import { Logger } from '@nestjs/common';
import { base } from 'viem/chains';
import type { Address } from 'viem';

const logger = new Logger('Zkp2pFulfilment');

// Minimal shape we need — avoids a structural type clash between the viem version
// resolved here and the one resolved via @zkp2p/sdk's own dependency tree.
type ReadOnlyClient = {
  readContract: (args: { address: Address; abi: any; functionName: string; args: any[] }) => Promise<unknown>;
};

// Reads a ZKP2P escrow deposit on Base and reports whether it has been fully fulfilled.
//
// remainingDeposits reaching 0 only means the deposit has been fully *claimed by intents* —
// a taker can signal an intent (which moves USDC from remainingDeposits into
// outstandingIntentAmount) well before they've actually paid the recipient and submitted proof.
// Real completion requires outstandingIntentAmount to ALSO be 0 — i.e. every claimed intent has
// been proven and paid out (totalAmountTaken), not just reserved. Shared by OfframpService and
// BeamService pollers.
export async function isZkp2pDepositFulfilled(
  publicClient: ReadOnlyClient,
  zkp2pDepositId: string,
): Promise<boolean> {
  try {
    const { getContracts } = await import('@zkp2p/sdk');
    const { addresses, abis } = getContracts(base.id, 'production');

    const deposit = await publicClient.readContract({
      address: addresses.escrow as Address,
      abi:     abis.escrow as any,
      functionName: 'getDeposit',
      args:    [BigInt(zkp2pDepositId)],
    }) as any;

    const remaining = deposit?.remainingDeposits ?? deposit?.remainingAmount ?? deposit?.deposit?.remainingDepositAmount;
    const outstanding = deposit?.outstandingIntentAmount ?? deposit?.deposit?.outstandingIntentAmount;
    return remaining !== undefined && outstanding !== undefined
      && BigInt(remaining) === 0n && BigInt(outstanding) === 0n;
  } catch (err: any) {
    logger.debug(`isZkp2pDepositFulfilled ${zkp2pDepositId}: ${err.message}`);
    return false;
  }
}

// Reads whether a deposit currently has any USDC locked in pending (unfulfilled) intents.
// A locked deposit cannot be safely cancelled — a taker may already be paying the recipient.
export async function getZkp2pDepositLockState(
  publicClient: ReadOnlyClient,
  zkp2pDepositId: string,
): Promise<{ locked: boolean; remaining: bigint; outstanding: bigint }> {
  const { getContracts } = await import('@zkp2p/sdk');
  const { addresses, abis } = getContracts(base.id, 'production');

  const deposit = await publicClient.readContract({
    address: addresses.escrow as Address,
    abi:     abis.escrow as any,
    functionName: 'getDeposit',
    args:    [BigInt(zkp2pDepositId)],
  }) as any;

  const remaining = BigInt(deposit?.remainingDeposits ?? deposit?.remainingAmount ?? deposit?.deposit?.remainingDepositAmount ?? 0);
  const outstanding = BigInt(deposit?.outstandingIntentAmount ?? deposit?.deposit?.outstandingIntentAmount ?? 0);
  return { locked: outstanding > 0n, remaining, outstanding };
}
