import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

jest.mock('@/modules/claims/solana-sponsor.service', () => ({ SolanaSponsorService: class {} }));
jest.mock('@/modules/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@/modules/partners/partners.service', () => ({ PartnersService: class {} }));
jest.mock('@/redis/redis.service', () => ({ RedisService: class {} }));

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { PayoutVaultService } from './payout-vault.service';
import { FakeDb, fakeRedis, fakeSupabase } from './payout-vault.fakes';

const make = (env: Record<string, string>) => {
  const db = new FakeDb();
  const cfg = { get: (k: string) => env[k] };
  const svc = new PayoutVaultService(fakeSupabase(db) as never, {} as never, {} as never, {} as never, fakeRedis as never, cfg as never);
  return { db, svc };
};
const ON = { PAYOUT_VAULT_ENABLED: 'true', PAYOUT_VAULT_COSIGNER_PRIVATE_KEY: bs58.encode(Keypair.generate().secretKey) };
const seedVault = (db: FakeDb, userId: string) => {
  const v = { id: 'v-' + userId, user_id: userId, multisig_pda: 'x', vault_address: 'y', user_wallet: 'w', cosigner: 'c', is_devnet: false };
  db.rows('payout_vaults').push(v);
  return v;
};
const seedExit = (db: FakeDb, userId: string, status = 'proposed') => {
  const e = { id: 'e-' + userId + status, vault_id: 'v-' + userId, user_id: userId, partner_id: 'p1', transaction_index: 1, status, destination: 'd', gross_units: 10, net_units: 9, fee_lines: [], message_hash: 'h', created_at: new Date().toISOString() };
  db.rows('payout_vault_exits').push(e);
  db.rows('payout_vault_credits').push({ id: 'c-' + e.id, vault_id: e.vault_id, partner_id: 'p1', payment_id: 'pay-' + e.id, units: 10, exit_id: e.id });
  return e;
};

describe('PayoutVaultService', () => {
  it('is off unless enabled and a co-signer key is set', async () => {
    await expect(make({}).svc.state('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(make({ PAYOUT_VAULT_ENABLED: 'true' }).svc.prepareExit('u1', 'org_x', 'So11111111111111111111111111111111111111112')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(make({ PAYOUT_VAULT_COSIGNER_PRIVATE_KEY: ON.PAYOUT_VAULT_COSIGNER_PRIVATE_KEY }).svc.state('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('shows nothing before the user has a vault', async () => {
    const { svc } = make(ON);
    expect(await svc.state('u1')).toEqual({ vault: null, credits: [] });
  });

  it('adds up what a user holds per partner, only what no exit has spent', async () => {
    const { db, svc } = make(ON);
    const v = seedVault(db, 'u1');
    db.rows('payout_vault_credits').push(
      { id: 'a', vault_id: v.id, partner_id: 'p1', payment_id: 'x1', units: 2_000_000, exit_id: null },
      { id: 'b', vault_id: v.id, partner_id: 'p1', payment_id: 'x2', units: 3_000_000, exit_id: null },
      { id: 'c', vault_id: v.id, partner_id: 'p2', payment_id: 'x3', units: 1_000_000, exit_id: 'spent' },
    );
    expect(await svc.state('u1')).toEqual({ vault: { address: 'y' }, credits: [{ partner_id: 'p1', usdc: 5 }] });
  });

  it('records a credit once, however many times the claim is retried', async () => {
    const { db, svc } = make(ON);
    seedVault(db, 'u1');
    await svc.recordCredit('u1', 'p1', 'pay-1', BigInt(5_000_000));
    await svc.recordCredit('u1', 'p1', 'pay-1', BigInt(5_000_000));
    expect(db.rows('payout_vault_credits')).toHaveLength(1);
    await expect(svc.recordCredit('u1', 'p1', 'pay-2', BigInt(0))).rejects.toThrow(/Nothing/);
  });

  it("answers 'not found' for someone else's exit, and never cancels it", async () => {
    const { db, svc } = make(ON);
    seedVault(db, 'owner');
    const e = seedExit(db, 'owner');
    await expect(svc.cancelExit('attacker', e.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.rows('payout_vault_exits')[0].status).toBe('proposed');
    await expect(svc.submitExit('attacker', e.id, 'AAAA')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancelling an exit gives its money back so it can be withdrawn again', async () => {
    const { db, svc } = make(ON);
    seedVault(db, 'u1');
    const e = seedExit(db, 'u1');
    expect(await svc.cancelExit('u1', e.id)).toEqual({ status: 'cancelled' });
    expect(db.rows('payout_vault_exits')[0].status).toBe('cancelled');
    expect(db.rows('payout_vault_credits')[0].exit_id).toBeNull();
    expect(await svc.cancelExit('u1', e.id)).toEqual({ status: 'cancelled' });
  });

  it('refuses to cancel a withdrawal that already went through', async () => {
    const { db, svc } = make(ON);
    seedVault(db, 'u1');
    const e = seedExit(db, 'u1', 'executed');
    await expect(svc.cancelExit('u1', e.id)).rejects.toBeInstanceOf(ConflictException);
    expect(db.rows('payout_vault_credits')[0].exit_id).toBe(e.id);
  });

  it('never co-signs an exit that expired or was cancelled', async () => {
    const { db, svc } = make(ON);
    seedVault(db, 'u1');
    const old = seedExit(db, 'u1');
    db.rows('payout_vault_exits')[0].created_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await expect(svc.submitExit('u1', old.id, 'AAAA')).rejects.toBeInstanceOf(ConflictException);
    expect(db.rows('payout_vault_exits')[0].status).toBe('cancelled');
    await expect(svc.submitExit('u1', old.id, 'AAAA')).rejects.toBeInstanceOf(ConflictException);
  });
});
