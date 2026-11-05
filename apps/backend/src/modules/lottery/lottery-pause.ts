import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Megapot shut down, so nothing may start a new ticket purchase. Paused unless LOTTERY_PAUSED=false.
 * Only entry points that begin a purchase check this: confirm, claim, withdraw and rescue paths stay open
 * so money and winnings already in flight can still settle.
 */
export const isLotteryPaused = (): boolean => process.env.LOTTERY_PAUSED !== 'false';

export function assertLotteryNotPaused(): void {
  if (isLotteryPaused()) {
    throw new ServiceUnavailableException('The daily draw is paused. Nothing was charged.');
  }
}
