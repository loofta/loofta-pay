import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58 = require('bs58').default ?? require('bs58');
import { SolanaSponsorService } from './solana-sponsor.service';
import { SupabaseService } from '@/database/supabase.service';
import { EmailService } from '@/modules/email/email.service';

// Real Solana instruction parsing/serialization runs unmocked below — only the network-touching
// and DB-touching pieces are stubbed, so this test exercises the actual intent-binding branch
// logic added for the 2026-08-04 "sign-and-broadcast volume gap" fix (see project memory:
// solana sponsor security hardening, Attack 6), not a paraphrase of it.
jest.mock('@/common/token-account-exists', () => ({
  tokenAccountExists: jest.fn().mockResolvedValue(false), // ATA never pre-exists -> always chargeable
}));
jest.mock('@/common/ata-sponsorship-guard', () => ({
  guardAtaSponsorship: jest.fn().mockResolvedValue(true),
  assertPerUserAtaCreationCapNotExceeded: jest.fn().mockResolvedValue(undefined),
  assertPerWalletAtaCreationCapNotExceeded: jest.fn().mockResolvedValue(undefined),
}));

const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function makeChainMock() {
  const mock: any = {};
  ['select', 'eq'].forEach((m) => (mock[m] = jest.fn().mockReturnThis()));
  mock.maybeSingle = jest.fn();
  return mock;
}

describe('SolanaSponsorService — intent-binding (claimId) checks', () => {
  let service: SolanaSponsorService;
  let feePayer: Keypair;
  let mockPayments: ReturnType<typeof makeChainMock>;
  let mockGiveaways: ReturnType<typeof makeChainMock>;

  /** Builds a real, correctly-serialized legacy tx creating one ATA for `owner`, paid by our fee
   *  payer. `transferAmountUnits`, if given, appends a real Transfer instruction moving that many
   *  USDC base units into the new ATA — needed to exercise the claim-amount enforcement added
   *  2026-08-07, which runs independently of the ATA-creation check. */
  function buildAtaCreationTxBase64(owner: PublicKey, transferAmountUnits?: number): string {
    const mint = new PublicKey(USDC_DEVNET_MINT);
    const ata = getAssociatedTokenAddressSync(mint, owner);
    const tx = new Transaction();
    tx.add(createAssociatedTokenAccountInstruction(feePayer.publicKey, ata, owner, mint));
    if (transferAmountUnits !== undefined) {
      const sourceAta = getAssociatedTokenAddressSync(mint, Keypair.generate().publicKey);
      tx.add(createTransferInstruction(sourceAta, ata, Keypair.generate().publicKey, transferAmountUnits));
    }
    tx.feePayer = feePayer.publicKey;
    tx.recentBlockhash = Keypair.generate().publicKey.toBase58(); // any valid base58 32-byte value
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    feePayer = Keypair.generate();
    mockPayments = makeChainMock();
    mockGiveaways = makeChainMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SolanaSponsorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SOLANA_FEE_PAYER_PRIVATE_KEY') return bs58.encode(feePayer.secretKey);
              return undefined;
            }),
          },
        },
        {
          provide: SupabaseService,
          useValue: { payments: mockPayments, giveaways: mockGiveaways },
        },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();

    service = module.get(SolanaSponsorService);
    expect(service.feePayerAddress).toBe(feePayer.publicKey.toBase58());
  });

  it('allows sponsorship when the ATA owner matches the payments row on file', async () => {
    const recipient = Keypair.generate().publicKey;
    mockPayments.maybeSingle.mockResolvedValueOnce({
      data: { id: 'pay-1', recipient_address: null, burner_address: recipient.toBase58() },
      error: null,
    });
    const txBase64 = buildAtaCreationTxBase64(recipient);

    await expect(
      (service as any).assertAtaCreationsAllowed(txBase64, {}, 'test', 'user-1', 'pay-1'),
    ).resolves.toBeUndefined();
  });

  it('blocks sponsorship when the transferred amount is below what the claim asks for', async () => {
    const recipient = Keypair.generate().publicKey;
    mockPayments.maybeSingle.mockResolvedValueOnce({
      data: { id: 'pay-1', recipient_address: null, burner_address: recipient.toBase58(), amount: 50 },
      error: null,
    });
    // Claim asks for $50 (50_000_000 base units) but the tx only transfers $10 — a client builds
    // this transaction itself, so nothing but this check stops it from lying about the amount.
    const txBase64 = buildAtaCreationTxBase64(recipient, 10_000_000);

    await expect(
      (service as any).assertAtaCreationsAllowed(txBase64, {}, 'test', 'attacker', 'pay-1'),
    ).rejects.toThrow('does not cover the amount owed');
  });

  it('allows sponsorship when the transferred amount meets what the claim asks for', async () => {
    const recipient = Keypair.generate().publicKey;
    mockPayments.maybeSingle.mockResolvedValueOnce({
      data: { id: 'pay-1', recipient_address: null, burner_address: recipient.toBase58(), amount: 50 },
      error: null,
    });
    const txBase64 = buildAtaCreationTxBase64(recipient, 50_000_000);

    await expect(
      (service as any).assertAtaCreationsAllowed(txBase64, {}, 'test', 'user-1', 'pay-1'),
    ).resolves.toBeUndefined();
  });

  it('blocks sponsorship when the ATA owner does NOT match the claimed payments row', async () => {
    const claimedRecipient = Keypair.generate().publicKey;
    const attackerWallet = Keypair.generate().publicKey;
    mockPayments.maybeSingle.mockResolvedValueOnce({
      data: { id: 'pay-1', recipient_address: null, burner_address: claimedRecipient.toBase58() },
      error: null,
    });
    // Attacker builds a real tx for pay-1 but redirects the ATA to their own wallet.
    const txBase64 = buildAtaCreationTxBase64(attackerWallet);

    await expect(
      (service as any).assertAtaCreationsAllowed(txBase64, {}, 'test', 'attacker', 'pay-1'),
    ).rejects.toThrow('does not match the claim');
  });

  it('rejects an unknown claimId outright — no silent fall-through to unpriced sponsorship', async () => {
    mockPayments.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const txBase64 = buildAtaCreationTxBase64(Keypair.generate().publicKey);

    await expect(
      (service as any).assertAtaCreationsAllowed(txBase64, {}, 'test', 'attacker', 'made-up-id'),
    ).rejects.toThrow('Claim not found');
  });

  // 2026-08-07 recurrence: a raw client-built transaction with NO claimId/pajOrderId/
  // nearIntentsOrderId/offrampRequestId/giveawayId used to fall through to "UNBOUND" and rely
  // solely on the (rotatable) per-user volume cap. Every real caller now passes one of the five
  // ids, so this must be refused outright, not merely capped.
  it('rejects a sponsor call with no backing intent id at all, even under the volume cap', async () => {
    const txBase64 = buildAtaCreationTxBase64(Keypair.generate().publicKey);

    await expect(
      (service as any).assertAtaCreationsAllowed(txBase64, {}, 'test', 'attacker'),
    ).rejects.toThrow('cannot be verified against a known claim, order, or giveaway');
  });

  it('allows sponsorship when the ATA owner matches the giveaway burner_address on file', async () => {
    const burner = Keypair.generate().publicKey;
    mockGiveaways.maybeSingle.mockResolvedValueOnce({
      data: { id: 'gw-1', burner_address: burner.toBase58() },
      error: null,
    });
    const txBase64 = buildAtaCreationTxBase64(burner);

    await expect(
      (service as any).assertAtaCreationsAllowed(txBase64, {}, 'test', 'user-1', undefined, undefined, undefined, undefined, 'gw-1'),
    ).resolves.toBeUndefined();
  });

  it('blocks sponsorship when the claim was created and is being paid by the same user (self-issued)', async () => {
    const recipient = Keypair.generate().publicKey;
    mockPayments.maybeSingle.mockResolvedValueOnce({
      data: { id: 'pay-1', recipient_address: null, burner_address: recipient.toBase58(), created_by: 'attacker' },
      error: null,
    });
    const txBase64 = buildAtaCreationTxBase64(recipient);

    await expect(
      (service as any).assertAtaCreationsAllowed(txBase64, {}, 'test', 'attacker', 'pay-1'),
    ).rejects.toThrow('a claim you created yourself');
  });

  it('allows sponsorship when the claim was created by someone else, even if the payer is authenticated', async () => {
    const recipient = Keypair.generate().publicKey;
    mockPayments.maybeSingle.mockResolvedValueOnce({
      data: { id: 'pay-1', recipient_address: null, burner_address: recipient.toBase58(), created_by: 'the-recipient' },
      error: null,
    });
    const txBase64 = buildAtaCreationTxBase64(recipient);

    await expect(
      (service as any).assertAtaCreationsAllowed(txBase64, {}, 'test', 'a-different-sender', 'pay-1'),
    ).resolves.toBeUndefined();
  });

  it('blocks sponsorship when the ATA owner does NOT match the giveaway burner_address on file', async () => {
    const realBurner = Keypair.generate().publicKey;
    const attackerWallet = Keypair.generate().publicKey;
    mockGiveaways.maybeSingle.mockResolvedValueOnce({
      data: { id: 'gw-1', burner_address: realBurner.toBase58() },
      error: null,
    });
    const txBase64 = buildAtaCreationTxBase64(attackerWallet);

    await expect(
      (service as any).assertAtaCreationsAllowed(txBase64, {}, 'test', 'attacker', undefined, undefined, undefined, undefined, 'gw-1'),
    ).rejects.toThrow('does not match the giveaway');
  });
});
