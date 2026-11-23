import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ClaimsService } from './claims.service';
import { tokenAccountExists } from '@/common/token-account-exists';

jest.mock('@/common/token-account-exists', () => ({ tokenAccountExists: jest.fn() }));

const MINT = Keypair.generate().publicKey;
const VAULT = Keypair.generate().publicKey;
const VAULT_ATA = getAssociatedTokenAddressSync(MINT, VAULT, true);
const U = (n: number) => BigInt(Math.round(n * 1_000_000));
const isTransfer = (d: Buffer) => d.length === 9 && d[0] === 3;
const isClose = (d: Buffer) => d.length === 1 && d[0] === 9;

type Opts = {
  claim?: Record<string, unknown>;
  held?: bigint | null; // what the burner holds; null: the chain cannot be read
  heldAfterFail?: bigint | null;
  sendFails?: boolean;
  raceLost?: boolean;
  vaultHasAccount?: boolean;
  compressed?: boolean;
};

function setup(o: Opts = {}) {
  const feePayer = Keypair.generate();
  const burner = Keypair.generate();
  const statuses: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const sentTx: Transaction[] = [];
  const claim = {
    id: 'c1', partner_id: 'pt1', status: 'SUCCESS', amount: '1', partner_withdrawn_at: null, recipient_claim_lock_at: null,
    claim_burner_address: burner.publicKey.toBase58(), claim_burner_encrypted_secret: 'enc', burner_compressed: o.compressed === true, ...o.claim,
  };
  const light = {
    buildDecompressInstruction: jest.fn(async () => ({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.from('d') })),
    sendInstructions: jest.fn(async () => 'LIGHTSIG'),
  };
  let calls = 0;
  const svc = Object.create(ClaimsService.prototype) as Record<string, unknown>;
  Object.assign(svc, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    lightCompression: light,
    findOneRaw: jest.fn(async () => claim),
    canDecryptBurnerSecret: () => true,
    decryptClaimBurnerSecret: () => Buffer.from(burner.secretKey),
    recipientClaimLockStaleCutoffIso: () => '2026-11-23T12:00:00.000Z',
    resolveClaimNetwork: () => ({ conn: { getBalance: async () => 50_000_000 }, claimMint: MINT, cluster: 'mainnet', tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }),
    solanaSponsor: { isAvailable: () => true, getFeePayerKeypair: () => feePayer },
    partnerBurnerUnits: jest.fn(async () => {
      calls++;
      const v = calls === 1 ? o.held : o.heldAfterFail === undefined ? o.held : o.heldAfterFail;
      if (v === null) throw new Error('rpc down');
      return v ?? U(1);
    }),
    sendAndConfirmWithRebuild: jest.fn(async (_c: unknown, tx: Transaction) => {
      if (o.sendFails) throw new Error('send failed');
      sentTx.push(tx);
      return 'ATASIG';
    }),
    supabaseService: {
      payments: {
        update: (v: Record<string, unknown>) => {
          updates.push(v);
          if (typeof v.status === 'string') statuses.push(v.status);
          const q: Record<string, unknown> = {};
          q.eq = () => q;
          q.is = () => q;
          q.select = async () => ({ data: o.raceLost && v.status === 'CANCELLED' ? [] : [{ id: 'c1' }], error: null });
          q.then = (res: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
          return q;
        },
      },
    },
  });
  (tokenAccountExists as jest.Mock).mockImplementation(async (_c: unknown, ata: PublicKey) => (ata.equals(VAULT_ATA) ? o.vaultHasAccount !== false : true));
  const run = (partnerId = 'pt1') => (svc as unknown as { refundPartnerPayout: (a: string, b: string, c: string) => Promise<{ amountUsdc: number; txHash: string | null }> }).refundPartnerPayout('c1', partnerId, VAULT.toBase58());
  return { run, statuses, updates, sentTx, light, svc, burner, feePayer };
}

describe('taking a partner payout back', () => {
  it('moves the whole burner balance to the company wallet and closes the token account, then marks it cancelled', async () => {
    const t = setup({ held: U(1) });
    const out = await t.run();
    expect(out).toEqual({ amountUsdc: 1, txHash: 'ATASIG' });
    const ixs = t.sentTx[0].instructions;
    const transfer = ixs.find((i) => isTransfer(i.data))!;
    expect(transfer.data.readBigUInt64LE(1)).toBe(U(1));
    expect(transfer.keys[1].pubkey.equals(VAULT_ATA)).toBe(true); // destination is the company wallet's account
    expect(ixs.some((i) => isClose(i.data))).toBe(true);
    // the rent from closing goes to the fee payer that paid it
    expect(ixs.find((i) => isClose(i.data))!.keys[1].pubkey.equals(t.feePayer.publicKey)).toBe(true);
    expect(t.statuses).toEqual(['CANCELLED']);
    expect(t.updates.some((u) => u.burner_reclaimed_at)).toBe(true);
  });

  it('a compressed burner is decompressed straight into the company wallet', async () => {
    const t = setup({ held: U(1), compressed: true });
    const out = await t.run();
    expect(out.txHash).toBe('LIGHTSIG');
    expect(t.light.buildDecompressInstruction).toHaveBeenCalledWith('mainnet', MINT, t.burner.publicKey, t.feePayer.publicKey, U(1), VAULT_ATA);
  });

  it("refuses another partner's payout and changes nothing", async () => {
    const t = setup({ claim: { partner_id: 'other' } });
    await expect(t.run()).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.statuses).toEqual([]);
  });

  it.each([
    ['already withdrawn', { partner_withdrawn_at: '2026-11-23T10:00:00Z' }],
    ['already cancelled', { status: 'CANCELLED' }],
    ['not funded yet', { status: 'PENDING' }],
    ['no burner', { claim_burner_address: null }],
  ])('refuses a payout that is %s', async (_n, claim) => {
    const t = setup({ claim });
    await expect(t.run()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.statuses).toEqual([]);
    expect(t.sentTx).toHaveLength(0);
  });

  it('refuses while the person is withdrawing it right now', async () => {
    const t = setup({ claim: { recipient_claim_lock_at: '2026-11-23T13:59:00.000Z' } });
    await expect(t.run()).rejects.toBeInstanceOf(ConflictException);
    expect(t.statuses).toEqual([]);
  });

  it('a stale lock does not block it', async () => {
    const t = setup({ claim: { recipient_claim_lock_at: '2026-11-23T09:00:00.000Z' } });
    await expect(t.run()).resolves.toBeDefined();
  });

  it('if the status changed under us it sends nothing', async () => {
    const t = setup({ raceLost: true });
    await expect(t.run()).rejects.toBeInstanceOf(ConflictException);
    expect(t.sentTx).toHaveLength(0);
  });

  it('when the transfer fails and the burner still holds the money, the payout is put back as it was', async () => {
    const t = setup({ held: U(1), heldAfterFail: U(1), sendFails: true });
    await expect(t.run()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.statuses).toEqual(['CANCELLED', 'SUCCESS']);
    expect(t.updates.some((u) => u.burner_reclaimed_at)).toBe(false);
  });

  it('when the transfer errors but the burner turns out to be empty, the money moved and it stays cancelled', async () => {
    const t = setup({ held: U(1), heldAfterFail: BigInt(0), sendFails: true });
    await expect(t.run()).resolves.toBeDefined();
    expect(t.statuses).toEqual(['CANCELLED']);
  });

  it('when the chain cannot be read after an error it stays cancelled, never guessing', async () => {
    const t = setup({ held: U(1), heldAfterFail: null, sendFails: true });
    await expect(t.run()).resolves.toBeDefined();
    expect(t.statuses).toEqual(['CANCELLED']);
  });

  it('puts the payout back when the company wallet has no USDC account', async () => {
    const t = setup({ held: U(1), heldAfterFail: U(1), vaultHasAccount: false });
    await expect(t.run()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.statuses).toEqual(['CANCELLED', 'SUCCESS']);
    expect(t.sentTx).toHaveLength(0);
  });
});
