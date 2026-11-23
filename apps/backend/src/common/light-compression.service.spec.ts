import { Keypair, PublicKey } from '@solana/web3.js';
import { ConfigService } from '@nestjs/config';
import { LightCompressionService, chunkTargets, compressedPayoutsEnabledFor, instructionGroups, COMPRESS_PER_TX } from './light-compression.service';

const cfg = (v: Record<string, string>) => ({ get: (k: string) => v[k] }) as unknown as ConfigService;

describe('chunking', () => {
  it('splits 35 payouts into 15, 15 and 5, keeping order', () => {
    const items = Array.from({ length: 35 }, (_, i) => i);
    const chunks = chunkTargets(items);
    expect(chunks.map((c) => c.length)).toEqual([15, 15, 5]);
    expect(chunks.flat()).toEqual(items);
  });

  it('a transaction of 15 is three instructions of 5', () => {
    expect(instructionGroups(Array.from({ length: COMPRESS_PER_TX }, (_, i) => i)).map((g) => g.length)).toEqual([5, 5, 5]);
  });

  it('nothing in, nothing out; bad size is refused', () => {
    expect(chunkTargets([])).toEqual([]);
    expect(() => chunkTargets([1], 0)).toThrow();
  });
});

describe('feature flag', () => {
  it('is off unless set', () => {
    expect(compressedPayoutsEnabledFor(cfg({}), 'p1')).toBe(false);
    expect(compressedPayoutsEnabledFor(cfg({ PARTNER_COMPRESSED_PAYOUTS: '' }), 'p1')).toBe(false);
    expect(compressedPayoutsEnabledFor(cfg({ PARTNER_COMPRESSED_PAYOUTS: '1' }), 'p1')).toBe(false);
  });

  it('"true" turns it on for every partner', () => {
    expect(compressedPayoutsEnabledFor(cfg({ PARTNER_COMPRESSED_PAYOUTS: 'true' }), 'anyone')).toBe(true);
  });

  it('a list of partner ids turns it on only for those', () => {
    const c = cfg({ PARTNER_COMPRESSED_PAYOUTS: ' p1 , p2 ' });
    expect(compressedPayoutsEnabledFor(c, 'p1')).toBe(true);
    expect(compressedPayoutsEnabledFor(c, 'p2')).toBe(true);
    expect(compressedPayoutsEnabledFor(c, 'p3')).toBe(false);
  });
});

describe('compressChunk', () => {
  const staging = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const ata = Keypair.generate().publicKey;
  const targets = [{ burner: Keypair.generate().publicKey.toBase58(), baseUnits: 1_000_000 }];

  function make(statuses: Array<{ err?: unknown; confirmationStatus?: string } | null>) {
    const calls: string[] = [];
    const rpc = {
      getAddressLookupTable: jest.fn(async () => ({ value: null })),
      getLatestBlockhash: jest.fn(async () => ({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 100 })),
      sendRawTransaction: jest.fn(async () => { calls.push('send'); return 'sig'; }),
      getSignatureStatuses: jest.fn(async () => ({ value: [statuses.shift() ?? null] })),
      getBlockHeight: jest.fn(async () => 50),
    };
    const svc = new LightCompressionService(cfg({ HELIUS_API_KEY: 'k' }));
    jest.spyOn(svc, 'rpc').mockReturnValue(rpc as never);
    jest.spyOn(svc, 'buildCompressInstructions').mockResolvedValue([]);
    return { svc, rpc, calls };
  }

  it('stores the signature BEFORE anything is sent, then returns it once confirmed', async () => {
    const { svc, calls } = make([{ confirmationStatus: 'confirmed' }]);
    const sig = await svc.compressChunk('devnet', mint, staging, ata, targets, async () => { calls.push('record'); });
    expect(calls).toEqual(['record', 'send']);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(40);
  });

  it('sends nothing if the signature cannot be stored', async () => {
    const { svc, rpc } = make([{ confirmationStatus: 'confirmed' }]);
    await expect(svc.compressChunk('devnet', mint, staging, ata, targets, async () => { throw new Error('db down'); })).rejects.toThrow('db down');
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('refuses an empty or oversized chunk', async () => {
    const svc = new LightCompressionService(cfg({ HELIUS_API_KEY: 'k' }));
    await expect(svc.buildCompressInstructions('devnet', mint, staging, ata, [])).rejects.toThrow();
    await expect(svc.buildCompressInstructions('devnet', mint, staging, ata, Array.from({ length: 16 }, () => targets[0]))).rejects.toThrow();
  });
});

describe('signatureOutcome', () => {
  it('tells landed, failed, expired and unknown apart', async () => {
    const svc = new LightCompressionService(cfg({ HELIUS_API_KEY: 'k' }));
    const status = (v: unknown, height = 50) => jest.spyOn(svc, 'rpc').mockReturnValue({ getSignatureStatuses: async () => ({ value: [v] }), getBlockHeight: async () => height } as never);
    status({ confirmationStatus: 'finalized' });
    expect(await svc.signatureOutcome('devnet', 's', 100)).toBe('landed');
    status({ err: { InstructionError: [0, 'x'] } });
    expect(await svc.signatureOutcome('devnet', 's', 100)).toBe('failed');
    status(null, 150);
    expect(await svc.signatureOutcome('devnet', 's', 100)).toBe('expired');
    status(null, 50);
    expect(await svc.signatureOutcome('devnet', 's', 100)).toBe('unknown');
    status(null, 150);
    expect(await svc.signatureOutcome('devnet', 's')).toBe('unknown'); // no expiry known: never assume it is safe to rebuild
  });
});

describe('sendInstructions', () => {
  const payer = Keypair.generate();
  function make(outcomes: Array<'landed' | 'failed' | 'expired' | 'unknown'>) {
    const rpc = {
      getAddressLookupTable: jest.fn(async () => ({ value: null })),
      getLatestBlockhash: jest.fn(async () => ({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 100 })),
      sendRawTransaction: jest.fn(async () => 'sig'),
    };
    const svc = new LightCompressionService(cfg({ HELIUS_API_KEY: 'k' }));
    jest.spyOn(svc, 'rpc').mockReturnValue(rpc as never);
    jest.spyOn(svc, 'signatureOutcome').mockImplementation(async () => outcomes.shift() ?? 'unknown');
    return { svc, rpc };
  }

  it('returns the signature once it lands', async () => {
    const { svc, rpc } = make(['landed']);
    const sig = await svc.sendInstructions('devnet', [], payer, []);
    expect(sig.length).toBeGreaterThan(40);
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('rebuilds with a fresh blockhash when the first one expires', async () => {
    const { svc, rpc } = make(['expired', 'landed']);
    await svc.sendInstructions('devnet', [], payer, []);
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
  });

  it('stops at once when the transaction fails on chain', async () => {
    const { svc, rpc } = make(['failed']);
    await expect(svc.sendInstructions('devnet', [], payer, [])).rejects.toThrow('failed on chain');
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempts it was allowed', async () => {
    const { svc } = make(['expired', 'expired']);
    await expect(svc.sendInstructions('devnet', [], payer, [], { maxAttempts: 2 })).rejects.toThrow('did not land');
  });
});
