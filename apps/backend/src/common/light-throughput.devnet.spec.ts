/**
 * Devnet check of how fast compress transactions go one at a time versus several at once. Skipped unless RUN_DEVNET_THROUGHPUT=1.
 * Needs HELIUS_API_KEY, DEVNET_KEYS_FILE (JSON array of secret keys, [0] is the funded fee payer and mint authority) and
 * DEVNET_TEST_MINT (a mint that already has a Light interface account).
 */
import { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync, mintTo } from '@solana/spl-token';
import { readFileSync } from 'fs';
import { LightCompressionService, chunkTargets } from './light-compression.service';

const RUN = process.env.RUN_DEVNET_THROUGHPUT === '1';

(RUN ? describe : describe.skip)('compress throughput on devnet', () => {
  jest.setTimeout(900_000);

  it('150 payouts: one transaction at a time, then four at a time', async () => {
    const keys = JSON.parse(readFileSync(process.env.DEVNET_KEYS_FILE!, 'utf8')) as number[][];
    const payer = Keypair.fromSecretKey(Uint8Array.from(keys[0]));
    const mint = new PublicKey(process.env.DEVNET_TEST_MINT!);
    const light = new LightCompressionService({ get: (k: string) => process.env[k] } as unknown as ConfigService);
    const conn = light.rpc('devnet');
    const stagingAta = getAssociatedTokenAddressSync(mint, payer.publicKey);
    await mintTo(conn, payer, mint, stagingAta, payer, BigInt(4_000_000)); // $4 of test USDC to spend

    const run = async (label: string, concurrency: number) => {
      const burners = Array.from({ length: 150 }, () => Keypair.generate());
      const groups = chunkTargets(burners.map((b) => ({ burner: b.publicKey.toBase58(), baseUnits: 10_000 })), 15);
      const failures: string[] = [];
      let next = 0;
      const t0 = Date.now();
      const worker = async () => {
        for (;;) {
          const g = groups[next++];
          if (!g) return;
          try {
            await light.compressChunk('devnet', mint, payer, stagingAta, g, async () => undefined);
          } catch (e) {
            failures.push((e as Error).message.slice(0, 120));
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
      const secs = (Date.now() - t0) / 1000;
      // every burner must hold exactly its $0.01
      let ok = 0;
      for (const b of burners.slice(0, 30)) if ((await light.compressedBalance('devnet', b.publicKey, mint)) === BigInt(10_000)) ok++;
      console.log(`[throughput] ${label}: ${groups.length} transactions in ${secs.toFixed(1)} s (${(groups.length / secs).toFixed(2)} tx/s), failures: ${failures.length}${failures[0] ? ' first: ' + failures[0] : ''}, sampled burners correct: ${ok}/30`);
      return { failures, ok };
    };

    const before = (await getAccount(conn, stagingAta)).amount;
    const a = await run('1 at a time', 1);
    const b = await run('4 at a time', 4);
    const after = (await getAccount(conn, stagingAta)).amount;
    console.log(`[throughput] staging spent: ${(Number(before - after) / 1e6).toFixed(2)} (expected 3.00)`);
    expect(a.failures).toHaveLength(0);
    expect(b.failures).toHaveLength(0);
    expect(a.ok).toBe(30);
    expect(b.ok).toBe(30);
    expect(before - after).toBe(BigInt(3_000_000));
  });
});
