import { BadRequestException } from '@nestjs/common';
import { TwitterAutopayService, RECLAIM_FEE_USD } from './twitter-autopay.service';
import { TestDb } from '../agent/test-db';

function build() {
  const db = new TestDb();
  const reclaimByCreator = jest.fn(async () => ({ cancelled: true }));
  const svc: any = Object.create(TwitterAutopayService.prototype);
  svc.supabaseService = { get payments() { return db.getClient().from('payments'); } };
  svc.claimsService = { reclaimByCreator };
  const row = (o: any) => db.rows('payments').push({ created_by: 'u1', status: 'SUCCESS', burner_address: 'B', recipient_address: 'PENDING_SOCIAL:telegram:bob_w', amount: '5', ...o });
  return { svc: svc as TwitterAutopayService, db, row, reclaimByCreator };
}

describe('taking back an unclaimed payment', () => {
  it('only offers payments still waiting in a burner, that the person created', async () => {
    const { svc, row } = build();
    row({ id: 'waiting' });
    row({ id: 'claimed', recipient_address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' });
    row({ id: 'cancelled', status: 'CANCELLED' });
    row({ id: 'noburner', burner_address: null });
    row({ id: 'someone-elses', created_by: 'u2' });
    const ok = await svc.unclaimedPaymentIds('u1', ['waiting', 'claimed', 'cancelled', 'noburner', 'someone-elses']);
    expect([...ok]).toEqual(['waiting']);
  });

  it('takes it back with the $0.05 fee and says what comes back', async () => {
    const { svc, row, reclaimByCreator } = build();
    row({ id: 'waiting', amount: '5' });
    expect(await svc.reclaimUnclaimed('u1', 'waiting')).toEqual({ returnedUsd: 4.95, feeUsd: 0.05 });
    expect(reclaimByCreator).toHaveBeenCalledWith('waiting', 'u1', { feeUsdc: RECLAIM_FEE_USD });
  });

  it('refuses a claimed payment and moves nothing', async () => {
    const { svc, row, reclaimByCreator } = build();
    row({ id: 'claimed', recipient_address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' });
    await expect(svc.reclaimUnclaimed('u1', 'claimed')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.reclaimUnclaimed('u2', 'claimed')).rejects.toBeInstanceOf(BadRequestException);
    expect(reclaimByCreator).not.toHaveBeenCalled();
  });
});
