import { BadRequestException } from '@nestjs/common';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { JupiterService } from './jupiter.service';

const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const SYS = '11111111111111111111111111111111';

// The guards are pure logic, so test them without the constructor's RPC connection.
function service(): any {
  return Object.create(JupiterService.prototype);
}

const meta = (pubkey: string, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });

describe('JupiterService sponsored swap guards', () => {
  describe('isGaslessPair', () => {
    const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const WSOL = 'So11111111111111111111111111111111111111112';
    const pair = (inputMint: string, outputMint: string) => ({ inputMint, outputMint, amount: '10' });

    it('sponsors only USDC to SOL, so a free swap can never be used to farm any other pair', () => {
      const s = service();
      expect(s.isGaslessPair(pair(USDC, WSOL))).toBe(true);
      expect(s.isGaslessPair(pair(WSOL, USDC))).toBe(false);
      expect(s.isGaslessPair(pair(USDC, Keypair.generate().publicKey.toBase58()))).toBe(false);
      expect(s.isGaslessPair(pair(Keypair.generate().publicKey.toBase58(), WSOL))).toBe(false);
    });
  });

  const feePayer = Keypair.generate().publicKey;
  const user = Keypair.generate().publicKey;
  const outMint = Keypair.generate().publicKey;

  describe('costFeeUsdcUnits', () => {
    it('charges the real cost with a 25% buffer in USDC, so no minimum swap is needed', () => {
      // 2 signatures + 100k priority lamports = 110,000 lamports = 0.00011 SOL at $100 = $0.011, x1.25 = $0.01375
      const cost = Number(service().costFeeUsdcUnits(0, 100));
      expect(cost).toBeGreaterThanOrEqual(13_750);
      expect(cost).toBeLessThanOrEqual(13_752);
    });

    it('adds token-account rent when an account has to be opened', () => {
      const withRent = service().costFeeUsdcUnits(1, 100);
      expect(withRent).toBeGreaterThan(service().costFeeUsdcUnits(0, 100));
      // 0.00204 SOL of rent at $100 = $0.204, with the buffer about $0.255 more
      expect(Number(withRent - service().costFeeUsdcUnits(0, 100)) / 1e6).toBeCloseTo(0.2549, 3);
    });

    it('caps the priority fee it is willing to recover, so a spike cannot inflate the charge', () => {
      expect(service().costFeeUsdcUnits(0, 100, 10_000_000)).toBe(service().costFeeUsdcUnits(0, 100));
    });
  });

  describe('assertSafeInstructions', () => {
    const ataCreate = (funder: string) => ({
      programId: ATA,
      accounts: [meta(funder, true, true), meta(Keypair.generate().publicKey.toBase58(), false, true), meta(user.toBase58()), meta(outMint.toBase58()), meta(SYS), meta(TOKEN)],
      data: '',
    });
    const swap = { programId: JUP, accounts: [meta(user.toBase58(), true, true)], data: '' };

    it('allows the fee payer to fund the output token account and nothing else', () => {
      expect(() => service().assertSafeInstructions([ataCreate(feePayer.toBase58()), swap], feePayer, user)).not.toThrow();
    });

    it('rejects a transfer that would move the fee payer\'s SOL', () => {
      const steal = { programId: SYS, accounts: [meta(feePayer.toBase58(), true, true), meta(user.toBase58(), false, true)], data: '' };
      expect(() => service().assertSafeInstructions([steal, swap], feePayer, user)).toThrow(BadRequestException);
    });

    it('rejects the fee payer appearing anywhere but the funding slot', () => {
      const sneaky = { programId: JUP, accounts: [meta(user.toBase58(), true, true), meta(feePayer.toBase58(), false, true)], data: '' };
      expect(() => service().assertSafeInstructions([sneaky], feePayer, user)).toThrow(BadRequestException);
    });

    it('rejects a program that is not on the allowlist', () => {
      const evil = { programId: Keypair.generate().publicKey.toBase58(), accounts: [], data: '' };
      expect(() => service().assertSafeInstructions([evil], feePayer, user)).toThrow(BadRequestException);
    });

    it('rejects an unexpected extra signer', () => {
      const other = Keypair.generate().publicKey.toBase58();
      const extra = { programId: JUP, accounts: [meta(user.toBase58(), true, true), meta(other, true, false)], data: '' };
      expect(() => service().assertSafeInstructions([extra], feePayer, user)).toThrow(BadRequestException);
    });
  });

  describe('isOutputAtaCreate', () => {
    it('only treats the user\'s account for the output mint as sponsored', () => {
      const s = service();
      const mine = { programId: ATA, accounts: [meta('x'), meta('y'), meta(user.toBase58()), meta(outMint.toBase58())], data: '' };
      const otherMint = { programId: ATA, accounts: [meta('x'), meta('y'), meta(user.toBase58()), meta(Keypair.generate().publicKey.toBase58())], data: '' };
      const otherOwner = { programId: ATA, accounts: [meta('x'), meta('y'), meta(Keypair.generate().publicKey.toBase58()), meta(outMint.toBase58())], data: '' };
      expect(s.isOutputAtaCreate(mine, user, outMint)).toBe(true);
      expect(s.isOutputAtaCreate(otherMint, user, outMint)).toBe(false);
      expect(s.isOutputAtaCreate(otherOwner, user, outMint)).toBe(false);
    });
  });

  describe('signatureValid and message hash', () => {
    const build = () => {
      const payer = Keypair.generate();
      const signer = Keypair.generate();
      const msg = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: payer.publicKey, lamports: 1 })],
      }).compileToV0Message();
      return { payer, signer, tx: new VersionedTransaction(msg) };
    };

    it('accepts a real signature from the user and rejects a missing or forged one', () => {
      const s = service();
      const { signer, tx } = build();
      const idx = tx.message.staticAccountKeys.findIndex((k: PublicKey) => k.equals(signer.publicKey));
      expect(s.signatureValid(tx, idx, signer.publicKey)).toBe(false); // unsigned
      tx.sign([signer]);
      expect(s.signatureValid(tx, idx, signer.publicKey)).toBe(true);
      expect(s.signatureValid(tx, idx, Keypair.generate().publicKey)).toBe(false); // wrong key
    });

    it('hashes the message, so any change to what the user signed is detected', () => {
      const s = service();
      const a = build();
      const b = build();
      expect(s.hashMessage(a.tx)).toBe(s.hashMessage(a.tx));
      expect(s.hashMessage(a.tx)).not.toBe(s.hashMessage(b.tx));
    });
  });
});
