import { BadRequestException } from '@nestjs/common';
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ClaimsService } from './claims.service';
import { tokenAccountExists } from '@/common/token-account-exists';

jest.mock('@/common/token-account-exists', () => ({ tokenAccountExists: jest.fn() }));

const MINT = Keypair.generate().publicKey;
const U = (n: number) => BigInt(Math.round(n * 1_000_000));

/** The amount in an SPL token transfer instruction (opcode 3, then u64 little endian). */
const transferAmount = (ix: TransactionInstruction) => ix.data.readBigUInt64LE(1);
const isTransfer = (ix: TransactionInstruction) => ix.data.length === 9 && ix.data[0] === 3;

function setup(opts: { compressed?: bigint; partnerFee?: bigint; looftaFee?: bigint | null; amount?: string; accountsExist?: Record<string, boolean>; prior?: string | null } = {}) {
  const feePayer = Keypair.generate();
  const burner = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const partnerWallet = Keypair.generate().publicKey;
  const sent: TransactionInstruction[][] = [];
  const marker = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.from('decompress') });
  const light = {
    compressedBalance: jest.fn(async () => opts.compressed ?? U(10)),
    buildDecompressInstruction: jest.fn(async () => marker),
    sendInstructions: jest.fn(async (_c: string, ixs: TransactionInstruction[]) => { sent.push(ixs); return 'SWEEPSIG'; }),
  };
  const updates: unknown[] = [];
  const svc = Object.create(ClaimsService.prototype) as Record<string, unknown>;
  Object.assign(svc, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    lightCompression: light,
    solanaSponsor: { getFeePayerKeypair: () => feePayer },
    supabaseService: { payments: { update: (v: unknown) => { updates.push(v); return { eq: async () => ({ error: null }) }; } } },
    recordPartnerPayoutEvent: jest.fn(async () => undefined),
    recordPartnerEarning: jest.fn(async () => undefined),
    guardAtaSponsorship: jest.fn(async () => true),
  });
  (tokenAccountExists as jest.Mock).mockImplementation(async () => true);
  if (opts.accountsExist) {
    (tokenAccountExists as jest.Mock).mockImplementation(async (_c: unknown, ata: PublicKey) => opts.accountsExist![ata.toBase58()] ?? true);
  }
  const conn = {
    getBalance: jest.fn(async () => 50_000_000),
    getSignaturesForAddress: jest.fn(async () => (opts.prior ? [{ signature: opts.prior, err: null }] : [])),
    getParsedTransaction: jest.fn(async () => ({ meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: burner.publicKey, signer: true }] } } })),
  };
  const run = (over: Record<string, unknown> = {}) =>
    (svc as unknown as { sweepCompressedPartnerBurner: (a: unknown) => Promise<{ sweepTxHash?: string; sweptAmount?: string }> }).sweepCompressedPartnerBurner({
      claimId: 'c1',
      claim: { amount: opts.amount ?? '10', is_devnet: true },
      destination: recipient.toBase58(),
      burnerKeypair: burner,
      conn,
      claimMint: MINT,
      partnerId: 'pt1',
      partnerFeeUnits: opts.partnerFee ?? U(0.5),
      partnerFeeWallet: partnerWallet.toBase58(),
      stampedLooftaFeeUnits: opts.looftaFee === undefined ? U(0.08) : opts.looftaFee,
      cluster: 'devnet',
      ...over,
    });
  return { run, light, sent, svc, feePayer, burner, recipient, partnerWallet, conn, updates, marker };
}

describe('compressed partner sweep', () => {
  it('decompresses the whole balance, then splits it: partner share, the person gets the rest, Loofta keeps its fee', async () => {
    const t = setup();
    const out = await t.run();
    expect(out.sweepTxHash).toBe('SWEEPSIG');
    const ixs = t.sent[0];
    expect(ixs).toContain(t.marker);
    const transfers = ixs.filter(isTransfer).map(transferAmount);
    expect(transfers).toEqual([U(0.5), U(10) - U(0.08) - U(0.5)]); // partner, then the person
    expect(out.sweptAmount).toBe('9.420000');
    // everything that leaves the staging stop plus Loofta's fee adds up to exactly what was decompressed
    expect(transfers.reduce((a, b) => a + b, BigInt(0)) + U(0.08)).toBe(U(10));
    expect(t.light.buildDecompressInstruction).toHaveBeenCalledWith('devnet', MINT, t.burner.publicKey, t.feePayer.publicKey, U(10), expect.anything());
    // the decompress comes before any transfer out of the account it fills
    expect(ixs.indexOf(t.marker)).toBeLessThan(ixs.findIndex(isTransfer));
  });

  it('marks the payout withdrawn and records the partner earning', async () => {
    const t = setup();
    await t.run();
    expect(t.updates.some((u) => (u as { partner_withdrawn_at?: string }).partner_withdrawn_at)).toBe(true);
    expect((t.svc.recordPartnerEarning as jest.Mock)).toHaveBeenCalledWith('c1', 'pt1', 0.5, expect.any(String), 'SWEEPSIG', true);
  });

  it('with no partner fee there is no partner transfer', async () => {
    const t = setup({ partnerFee: BigInt(0) });
    await t.run();
    expect(t.sent[0].filter(isTransfer).map(transferAmount)).toEqual([U(10) - U(0.08)]);
  });

  it('sends nothing when the burner holds less than the payout, and there is no earlier sweep', async () => {
    const t = setup({ compressed: BigInt(0) });
    await expect(t.run()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.light.sendInstructions).not.toHaveBeenCalled();
  });

  it('an empty burner with a sweep it signed itself is recorded as delivered, never swept twice', async () => {
    const t = setup({ compressed: BigInt(0), prior: 'OLDSIG' });
    const out = await t.run();
    expect(out.sweepTxHash).toBe('OLDSIG');
    expect(t.light.sendInstructions).not.toHaveBeenCalled();
    expect(t.updates.some((u) => (u as { partner_withdrawn_at?: string }).partner_withdrawn_at)).toBe(true);
  });

  it('refuses a partner share that is too large', async () => {
    const t = setup({ partnerFee: U(9) });
    await expect(t.run()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.light.sendInstructions).not.toHaveBeenCalled();
  });

  it('refuses when fees leave nothing for the person', async () => {
    const t = setup({ partnerFee: U(2), looftaFee: U(9) });
    await expect(t.run()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.light.sendInstructions).not.toHaveBeenCalled();
  });

  it('keeps the money untouched when the partner fee wallet has no USDC account', async () => {
    const t = setup();
    const missing = getAssociatedTokenAddressSync(MINT, t.partnerWallet, true).toBase58();
    (tokenAccountExists as jest.Mock).mockImplementation(async (_c: unknown, ata: PublicKey) => ata.toBase58() !== missing);
    await expect(t.run()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.light.sendInstructions).not.toHaveBeenCalled();
  });

  it('is unavailable, with nothing sent, when the fee payer has no SOL', async () => {
    const t = setup();
    t.conn.getBalance.mockResolvedValue(10);
    await expect(t.run()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.light.sendInstructions).not.toHaveBeenCalled();
  });

  it('treats a missing Loofta fee stamp as no fee, never a guess', async () => {
    const t = setup({ looftaFee: null });
    await t.run();
    const transfers = t.sent[0].filter(isTransfer).map(transferAmount);
    expect(transfers.reduce((a, b) => a + b, BigInt(0))).toBe(U(10));
  });
});
