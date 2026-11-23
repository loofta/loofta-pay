/**
 * Devnet end-to-end for compressed partner payouts. Skipped unless RUN_DEVNET_COMPRESSED=1.
 *
 * Real: the Squads multisig and vault transaction, the Light compress and decompress, LightCompressionService,
 * and ClaimsService.sweepCompressedPartnerBurner (the real claim code, with the database calls stubbed).
 * Replicated: the proposal's single staging transfer (PartnerTreasuryService.buildPayoutProposal needs a database).
 *
 * Needs HELIUS_API_KEY, DEVNET_KEYS_FILE (JSON array of secret keys: [0] funded fee payer and mint authority),
 * DEVNET_TEST_MINT (an SPL mint that already has a Light interface account, owned by that fee payer).
 */
import { ConfigService } from '@nestjs/config';
import { AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAccount, getAssociatedTokenAddressSync, mintTo } from '@solana/spl-token';
import * as multisig from '@sqds/multisig';
import { readFileSync } from 'fs';
import { LightCompressionService, chunkTargets } from '@/common/light-compression.service';
import { ClaimsService } from './claims.service';

const RUN = process.env.RUN_DEVNET_COMPRESSED === '1';
const U = (n: number) => BigInt(Math.round(n * 1_000_000));
const { Permissions } = multisig.types;

(RUN ? describe : describe.skip)('compressed partner payouts on devnet', () => {
  jest.setTimeout(900_000);

  it('stages through a Squads vault, compresses 20 payouts, and withdraws two with the fee split', async () => {
    const keys = JSON.parse(readFileSync(process.env.DEVNET_KEYS_FILE!, 'utf8')) as number[][];
    const payer = Keypair.fromSecretKey(Uint8Array.from(keys[0])); // our fee payer, mint authority and staging owner
    const mint = new PublicKey(process.env.DEVNET_TEST_MINT!);
    const light = new LightCompressionService({ get: (k: string) => process.env[k] } as unknown as ConfigService);
    const conn = light.rpc('devnet');
    const lap = async (label: string, t0: number) => console.log(`[devnet] ${label}: ${Date.now() - t0} ms`);
    const send = async (label: string, ixs: TransactionInstruction[], signers: Keypair[], lut: AddressLookupTableAccount[] = []) => {
      const t0 = Date.now();
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(lut));
      tx.sign(signers);
      const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
      for (let i = 0; i < 120; i++) {
        const o = await light.signatureOutcome('devnet', sig, lastValidBlockHeight);
        if (o === 'landed') { await lap(label, t0); return sig; }
        if (o === 'failed' || o === 'expired') throw new Error(`${label}: ${o}`);
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`${label}: not confirmed`);
    };

    // 1. A company wallet: a 1-of-1 Squads multisig whose vault holds the partner's test USDC.
    const member = Keypair.generate();
    const createKey = Keypair.generate();
    const [msPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
    const [vault] = multisig.getVaultPda({ multisigPda: msPda, index: 0 });
    const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(conn, multisig.getProgramConfigPda({})[0]);
    await send('create company wallet', [
      multisig.instructions.multisigCreateV2({
        treasury: programConfig.treasury, creator: payer.publicKey, multisigPda: msPda, configAuthority: null, threshold: 1,
        members: [{ key: member.publicKey, permissions: Permissions.all() }], timeLock: 0, createKey: createKey.publicKey, rentCollector: payer.publicKey,
      }),
    ], [payer, createKey]);

    const vaultAta = getAssociatedTokenAddressSync(mint, vault, true);
    const stagingAta = getAssociatedTokenAddressSync(mint, payer.publicKey);
    await send('create token accounts', [
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, vaultAta, vault, mint),
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, stagingAta, payer.publicKey, mint),
    ], [payer]);
    await mintTo(conn, payer, mint, vaultAta, payer, U(10));
    const stagedBefore = (await getAccount(conn, stagingAta)).amount;

    // 2. The proposal: ONE transfer from the vault to staging for the whole batch, approved and executed by the member.
    const total = U(10);
    const index = BigInt(1);
    const transferIx = createTransferInstruction(vaultAta, stagingAta, vault, total);
    const message = new TransactionMessage({ payerKey: vault, recentBlockhash: PublicKey.default.toBase58(), instructions: [transferIx] });
    await send('proposal: create, propose, approve', [
      multisig.instructions.vaultTransactionCreate({ multisigPda: msPda, transactionIndex: index, creator: member.publicKey, rentPayer: payer.publicKey, vaultIndex: 0, ephemeralSigners: 0, transactionMessage: message }),
      multisig.instructions.proposalCreate({ multisigPda: msPda, transactionIndex: index, creator: member.publicKey, rentPayer: payer.publicKey }),
      multisig.instructions.proposalApprove({ multisigPda: msPda, transactionIndex: index, member: member.publicKey }),
    ], [payer, member]);
    const exec = await multisig.instructions.vaultTransactionExecute({ connection: conn, multisigPda: msPda, transactionIndex: index, member: member.publicKey });
    await send('proposal: execute', [exec.instruction], [payer, member], exec.lookupTableAccounts);
    expect((await getAccount(conn, stagingAta)).amount - stagedBefore).toBe(total);

    // 3. Compress 20 payouts of $0.50 into 20 burners, 15 per transaction, signature saved before each send.
    const burners = Array.from({ length: 20 }, () => Keypair.generate());
    const targets = burners.map((b) => ({ burner: b.publicKey.toBase58(), baseUnits: Number(U(0.5)) }));
    const saved: string[] = [];
    for (const chunk of chunkTargets(targets)) {
      const t0 = Date.now();
      const sig = await light.compressChunk('devnet', mint, payer, stagingAta, chunk, async (s) => { saved.push(s); });
      await lap(`compress ${chunk.length} payouts`, t0);
      expect(saved[saved.length - 1]).toBe(sig);
    }
    expect(saved).toHaveLength(2);
    expect((await getAccount(conn, stagingAta)).amount).toBe(stagedBefore);
    for (const i of [0, 19]) expect(await light.compressedBalance('devnet', burners[i].publicKey, mint)).toBe(U(0.5));
    console.log('[devnet] burners hold no token account:', (await conn.getParsedTokenAccountsByOwner(burners[0].publicKey, { mint })).value.length === 0);

    // 4. Withdraw two payouts through the real claim code: the person has no USDC account yet (so one is created).
    const partnerWallet = Keypair.generate();
    const partnerAta = getAssociatedTokenAddressSync(mint, partnerWallet.publicKey);
    await send('create partner fee account', [createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, partnerAta, partnerWallet.publicKey, mint)], [payer]);

    const svc = Object.create(ClaimsService.prototype) as Record<string, unknown>;
    const withdrawn: string[] = [];
    Object.assign(svc, {
      logger: { log: () => undefined, warn: console.warn, error: console.error },
      lightCompression: light,
      solanaSponsor: { getFeePayerKeypair: () => payer },
      supabaseService: { payments: { update: (v: { partner_withdrawn_at?: string }) => ({ eq: async (_c: string, id: string) => { if (v.partner_withdrawn_at) withdrawn.push(id); return { error: null }; } }) } },
      recordPartnerPayoutEvent: async () => undefined,
      recordPartnerEarning: async () => undefined,
      guardAtaSponsorship: async () => true,
    });
    const sweep = (svc as unknown as { sweepCompressedPartnerBurner: (a: unknown) => Promise<{ sweepTxHash?: string; sweptAmount?: string }> }).sweepCompressedPartnerBurner.bind(svc);

    const stagedMid = (await getAccount(conn, stagingAta)).amount;
    const people = [Keypair.generate(), Keypair.generate()];
    for (const [n, i] of [0, 19].entries()) {
      const t0 = Date.now();
      const out = await sweep({
        claimId: `claim${i}`, claim: { amount: '0.5', is_devnet: true }, destination: people[n].publicKey.toBase58(), burnerKeypair: burners[i], conn, claimMint: mint,
        partnerId: 'pt1', partnerFeeUnits: U(0.02), partnerFeeWallet: partnerWallet.publicKey.toBase58(), stampedLooftaFeeUnits: U(0.05), cluster: 'devnet',
      });
      await lap(`withdraw payout ${i}`, t0);
      expect(out.sweptAmount).toBe('0.430000');
      const personAta = getAssociatedTokenAddressSync(mint, people[n].publicKey);
      expect((await getAccount(conn, personAta)).amount).toBe(U(0.43));
      expect(await light.compressedBalance('devnet', burners[i].publicKey, mint)).toBe(BigInt(0));
    }
    expect((await getAccount(conn, partnerAta)).amount).toBe(U(0.04));
    expect((await getAccount(conn, stagingAta)).amount - stagedMid).toBe(U(0.1)); // Loofta kept $0.05 from each
    expect(withdrawn).toEqual(['claim0', 'claim19']);
    // the other 18 payouts are untouched
    expect(await light.compressedBalance('devnet', burners[5].publicKey, mint)).toBe(U(0.5));

    // 5. A second withdraw of the same payout finds nothing and sends nothing.
    await expect(sweep({
      claimId: 'claim0', claim: { amount: '0.5', is_devnet: true }, destination: people[0].publicKey.toBase58(), burnerKeypair: burners[0], conn, claimMint: mint,
      partnerId: 'pt1', partnerFeeUnits: U(0.02), partnerFeeWallet: partnerWallet.publicKey.toBase58(), stampedLooftaFeeUnits: U(0.05), cluster: 'devnet',
    })).resolves.toBeDefined(); // recognised as already swept (the burner signed it), recorded, not sent again
    expect((await getAccount(conn, getAssociatedTokenAddressSync(mint, people[0].publicKey))).amount).toBe(U(0.43));
  });
});
