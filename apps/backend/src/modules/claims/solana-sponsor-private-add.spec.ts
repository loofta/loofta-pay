import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58 = require('bs58').default ?? require('bs58');
import { SolanaSponsorService } from './solana-sponsor.service';
import { SupabaseService } from '@/database/supabase.service';
import { EmailService } from '@/modules/email/email.service';
import * as guard from '@/common/ata-sponsorship-guard';

jest.mock('@/common/ata-sponsorship-guard', () => ({
  guardAtaSponsorship: jest.fn().mockResolvedValue(true),
  assertPerUserAtaCreationCapNotExceeded: jest.fn().mockResolvedValue(undefined),
  assertPerWalletAtaCreationCapNotExceeded: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/common/magicblock-private-transfer', () => ({ fetchSolPriceUsd: jest.fn().mockResolvedValue(150) }));

const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

describe('SolanaSponsorService.broadcastMatchedRelayDeposit with a sponsor-created deposit account (private Earn add)', () => {
  let service: SolanaSponsorService;
  let feePayer: Keypair;
  let user: Keypair;
  let deposit: PublicKey;
  let depositAta: PublicKey;
  let userAta: PublicKey;
  let send: jest.Mock;

  const storedTransfer = (amount: bigint) => {
    const ix = createTransferCheckedInstruction(userAta, USDC, depositAta, user.publicKey, amount, 6);
    return {
      ix,
      stored: {
        programId: ix.programId.toBase58(),
        keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: Buffer.from(ix.data).toString('hex'),
      },
    };
  };

  const build = (ixs: any[]) => {
    const msg = new TransactionMessage({
      payerKey: feePayer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: ixs,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([user]); // the person's signature; the sponsor adds the fee payer's
    return Buffer.from(tx.serialize()).toString('base64');
  };

  beforeEach(async () => {
    feePayer = Keypair.generate();
    user = Keypair.generate();
    deposit = Keypair.generate().publicKey;
    depositAta = getAssociatedTokenAddressSync(USDC, deposit, true);
    userAta = getAssociatedTokenAddressSync(USDC, user.publicKey);
    send = jest.fn().mockResolvedValue('sig123');
    (guard.guardAtaSponsorship as jest.Mock).mockClear().mockResolvedValue(true);

    const mod = await Test.createTestingModule({
      providers: [
        SolanaSponsorService,
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => (k === 'SOLANA_FEE_PAYER_PRIVATE_KEY' ? bs58.encode(feePayer.secretKey) : undefined)) } },
        { provide: SupabaseService, useValue: {} },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();
    service = mod.get(SolanaSponsorService);
    (service as any).connection = { sendRawTransaction: send };
  });

  const create = () => ({ ata: depositAta, owner: deposit, mint: USDC });
  const createIx = () => createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, depositAta, deposit, USDC);

  it('sends [create deposit account, transfer] and runs the ATA guards', async () => {
    const { ix, stored } = storedTransfer(2_000_000n);
    const tx = build([createIx(), ix]);
    await expect(service.broadcastMatchedRelayDeposit({
      transactionBase64: tx, userSolanaAddress: user.publicKey.toBase58(), instructions: [stored], createAta: create(), userId: 'u1',
    })).resolves.toEqual({ signature: 'sig123' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(guard.guardAtaSponsorship).toHaveBeenCalledTimes(1);
    expect(guard.assertPerUserAtaCreationCapNotExceeded).toHaveBeenCalledWith(expect.anything(), 'u1', 1, expect.any(String));
  });

  it('refuses when the created account belongs to someone other than the quoted deposit address', async () => {
    const { ix, stored } = storedTransfer(2_000_000n);
    const attacker = Keypair.generate().publicKey;
    const evil = createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, getAssociatedTokenAddressSync(USDC, attacker, true), attacker, USDC);
    await expect(service.broadcastMatchedRelayDeposit({
      transactionBase64: build([evil, ix]), userSolanaAddress: user.publicKey.toBase58(), instructions: [stored], createAta: create(), userId: 'u1',
    })).rejects.toThrow('token account creation does not match');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a transaction with an extra create-account instruction when none was quoted', async () => {
    const { ix, stored } = storedTransfer(2_000_000n);
    await expect(service.broadcastMatchedRelayDeposit({
      transactionBase64: build([createIx(), ix]), userSolanaAddress: user.publicKey.toBase58(), instructions: [stored], createAta: null, userId: 'u1',
    })).rejects.toThrow('does not match the quoted bridge');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses when the transfer amount is changed from the quote', async () => {
    const { stored } = storedTransfer(2_000_000n);
    const { ix: bigger } = storedTransfer(9_000_000n);
    await expect(service.broadcastMatchedRelayDeposit({
      transactionBase64: build([createIx(), bigger]), userSolanaAddress: user.publicKey.toBase58(), instructions: [stored], createAta: create(), userId: 'u1',
    })).rejects.toThrow('does not match the quoted bridge');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses when the sponsorship guard says no', async () => {
    (guard.guardAtaSponsorship as jest.Mock).mockResolvedValueOnce(false);
    const { ix, stored } = storedTransfer(2_000_000n);
    await expect(service.broadcastMatchedRelayDeposit({
      transactionBase64: build([createIx(), ix]), userSolanaAddress: user.publicKey.toBase58(), instructions: [stored], createAta: create(), userId: 'u1',
    })).rejects.toThrow('refused by the sponsorship guard');
    expect(send).not.toHaveBeenCalled();
  });
});
