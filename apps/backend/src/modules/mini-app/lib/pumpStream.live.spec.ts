/** Live check of the PumpPortal stream, off by default: RUN_PUMP_LIVE=1 PUMPPORTAL_API_KEY=... npx jest pumpStream.live */
import { streamCoins, streamLive } from './pumpStream';

const live = process.env.RUN_PUMP_LIVE === '1' ? describe : describe.skip;
live('pumpStream (live)', () => {
  jest.setTimeout(90_000);
  it('connects and receives launches', async () => {
    streamCoins();
    await new Promise((r) => setTimeout(r, 40_000));
    const coins = streamCoins();
    console.log('live:', streamLive(), 'coins:', coins.length, coins[0]?.symbol);
    expect(coins.length).toBeGreaterThan(0);
  });
});
