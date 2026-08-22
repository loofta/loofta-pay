import { ConfigService } from '@nestjs/config';
import { GachaCronService } from './gacha-cron.service';
import { GachaService } from './gacha.service';

describe('GachaCronService', () => {
  const makeService = (nodeEnv: string) => {
    const gacha = {
      advanceExcludingRooms: jest.fn().mockResolvedValue(undefined),
      advanceVotingRooms: jest.fn().mockResolvedValue(undefined),
      advanceStalledBuybackSettlements: jest.fn().mockResolvedValue(undefined),
      advancePhaseGates: jest.fn().mockResolvedValue(undefined),
      settleDueRooms: jest.fn().mockResolvedValue(undefined),
    };
    const config = { get: jest.fn().mockReturnValue(nodeEnv) };
    return {
      service: new GachaCronService(
        gacha as unknown as GachaService,
        config as unknown as ConfigService,
      ),
      gacha,
    };
  };

  it('polls VRF exclusion and voting lifecycle in development without running settlement', async () => {
    const { service, gacha } = makeService('development');

    await service.sweep();

    expect(gacha.advanceExcludingRooms).toHaveBeenCalledTimes(1);
    expect(gacha.advanceVotingRooms).toHaveBeenCalledTimes(1);
    expect(gacha.advanceStalledBuybackSettlements).toHaveBeenCalledTimes(1);
    expect(gacha.advancePhaseGates).toHaveBeenCalledTimes(1);
    expect(gacha.settleDueRooms).not.toHaveBeenCalled();
  });

  it('also runs the legacy settlement sweep in production', async () => {
    const { service, gacha } = makeService('production');

    await service.sweep();

    expect(gacha.advanceExcludingRooms).toHaveBeenCalledTimes(1);
    expect(gacha.advanceVotingRooms).toHaveBeenCalledTimes(1);
    expect(gacha.advanceStalledBuybackSettlements).toHaveBeenCalledTimes(1);
    expect(gacha.advancePhaseGates).toHaveBeenCalledTimes(1);
    expect(gacha.settleDueRooms).toHaveBeenCalledTimes(1);
  });
});
