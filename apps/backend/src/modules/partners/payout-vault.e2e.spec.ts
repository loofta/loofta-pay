/**
 * Runs the real payout vault against a real Solana validator with the Squads program loaded, using throwaway keys and a
 * test mint. Skipped unless PAYOUT_VAULT_E2E_RPC points at one (for example a local solana-test-validator with the
 * Squads program and its program config cloned from mainnet).
 */
jest.mock('@/modules/claims/solana-sponsor.service', () => ({ SolanaSponsorService: class {} }));
jest.mock('@/modules/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@/modules/partners/partners.service', () => ({ PartnersService: class {} }));
jest.mock('@/redis/redis.service', () => ({ RedisService: class {} }));

import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import { PayoutVaultService } from './payout-vault.service';
import { FakeDb, fakeRedis, fakeSupabase } from './payout-vault.fakes';

const RPC = process.env.PAYOUT_VAULT_E2E_RPC;
const d = RPC ? describe : describe.skip;

d('PayoutVaultService on a real validator', () => {
  jest.setTimeout(240_000);
  const conn = new Connection(RPC || 'http://127.0.0.1:8899', 'confirmed');
  const sponsor = Keypair.generate(), user = Keypair.generate(), cosigner = Keypair.generate();
  const partnerWallet = Keypair.generate(), dest = Keypair.generate();
  let mint: Awaited<ReturnType<typeof createMint>>;
  const db = new FakeDb();
  let svc: PayoutVaultService;
  const bal = async (owner: Keypair | { publicKey: any }, off = false) =>
    Number((await getAccount(conn, (await getOrCreateAssociatedTokenAccount(conn, sponsor, mint, owner.publicKey, off)).address)).amount) / 1e6;

  beforeAll(async () => {
    await conn.confirmTransaction(await conn.requestAirdrop(sponsor.publicKey, 5 * LAMPORTS_PER_SOL), 'confirmed');
    mint = await createMint(conn, sponsor, sponsor.publicKey, null, 6);
    await getOrCreateAssociatedTokenAccount(conn, sponsor, mint, partnerWallet.publicKey);
    await getOrCreateAssociatedTokenAccount(conn, sponsor, mint, dest.publicKey);
    db.rows('partners').push({ id: 'p1', org_id: 'org_x', status: 'active', fee_fixed_usd: 0.5, fee_percent_bps: 200, fee_wallet: partnerWallet.publicKey.toBase58() });
    const env: Record<string, string> = {
      PAYOUT_VAULT_ENABLED: 'true', PAYOUT_VAULT_COSIGNER_PRIVATE_KEY: bs58.encode(cosigner.secretKey), SOLANA_USDC_MINT_MAINNET: mint.toBase58(),
    };
    svc = new PayoutVaultService(
      fakeSupabase(db) as never,
      { assertFeeWalletReady: async () => undefined } as never,
      { getSolanaWalletAddress: async () => user.publicKey.toBase58() } as never,
      { getFeePayerKeypair: () => sponsor, getConnectionForCluster: () => conn } as never,
      fakeRedis as never,
      { get: (k: string) => env[k] } as never,
    );
  });

  it('creates a vault no one can open alone, and pays the fees only when the user approves', async () => {
    const vault = await svc.getOrCreateVault('u1');
    expect((await svc.getOrCreateVault('u1')).id).toBe(vault.id);
    const vaultOwner = { publicKey: new (require('@solana/web3.js').PublicKey)(vault.vault_address) };
    await mintTo(conn, sponsor, mint, (await getOrCreateAssociatedTokenAccount(conn, sponsor, mint, vaultOwner.publicKey, true)).address, sponsor, 100_000_000n);
    await svc.recordCredit('u1', 'p1', '11111111-1111-4111-8111-111111111111', 60_000_000n);
    await svc.recordCredit('u1', 'p1', '22222222-2222-4222-8222-222222222222', 40_000_000n);

    // Preparing an exit moves nothing: Loofta waits for the user.
    const exit = await svc.prepareExit('u1', 'org_x', dest.publicKey.toBase58());
    expect(exit.fees).toEqual([{ kind: 'partner', label: 'Partner fee', usdc: 2.5 }]);
    expect(exit.net_usdc).toBe(97.5);
    expect(await bal(vaultOwner, true)).toBe(100);
    expect(await bal(dest)).toBe(0);

    // A second exit for the same partner is refused while one is open.
    await expect(svc.prepareExit('u1', 'org_x', dest.publicKey.toBase58())).rejects.toThrow(/in progress/);

    // Submitting without the user's signature, or with a different transaction, is refused and moves nothing.
    await expect(svc.submitExit('u1', exit.exit_id, exit.unsigned_transaction)).rejects.toThrow(/signature is missing/);
    const other = VersionedTransaction.deserialize(Buffer.from(exit.unsigned_transaction, 'base64'));
    other.message.recentBlockhash = bs58.encode(Buffer.alloc(32, 1));
    other.sign([user]);
    await expect(svc.submitExit('u1', exit.exit_id, Buffer.from(other.serialize()).toString('base64'))).rejects.toThrow(/not the transaction/);
    expect(await bal(dest)).toBe(0);

    // The user approves; Loofta then approves and executes. Net to the destination, the fee to the partner, nothing left.
    const tx = VersionedTransaction.deserialize(Buffer.from(exit.unsigned_transaction, 'base64'));
    tx.sign([user]);
    const done = await svc.submitExit('u1', exit.exit_id, Buffer.from(tx.serialize()).toString('base64'));
    expect(done.status).toBe('executed');
    expect(await bal(dest)).toBe(97.5);
    expect(await bal(partnerWallet)).toBe(2.5);
    expect(await bal(vaultOwner, true)).toBe(0);
    expect(await svc.state('u1')).toEqual({ vault: { address: vault.vault_address }, credits: [] });
    expect(db.rows('partner_payment_fee_lines').map((r) => r.kind)).toEqual(['partner', 'partner']);
    expect((await svc.submitExit('u1', exit.exit_id, 'x')).status).toBe('executed');
  });

  it('a walked-away exit costs nothing and the money can be withdrawn again', async () => {
    const vault = await svc.getOrCreateVault('u1');
    const owner = new (require('@solana/web3.js').PublicKey)(vault.vault_address);
    await mintTo(conn, sponsor, mint, (await getOrCreateAssociatedTokenAccount(conn, sponsor, mint, owner, true)).address, sponsor, 20_000_000n);
    await svc.recordCredit('u1', 'p1', '33333333-3333-4333-8333-333333333333', 20_000_000n);
    const exit = await svc.prepareExit('u1', 'org_x', dest.publicKey.toBase58());
    const before = await bal(partnerWallet);
    await svc.cancelExit('u1', exit.exit_id);
    // Even if the user's approval is sent later, Loofta never co-signs a cancelled exit.
    const tx = VersionedTransaction.deserialize(Buffer.from(exit.unsigned_transaction, 'base64'));
    tx.sign([user]);
    await expect(svc.submitExit('u1', exit.exit_id, Buffer.from(tx.serialize()).toString('base64'))).rejects.toThrow(/no longer open/);
    expect(await bal(partnerWallet)).toBe(before);
    expect(await bal({ publicKey: owner }, true)).toBe(20);
    expect((await svc.state('u1')).credits).toEqual([{ partner_id: 'p1', usdc: 20 }]);
    const again = await svc.prepareExit('u1', 'org_x', dest.publicKey.toBase58());
    expect(again.exit_id).not.toBe(exit.exit_id);
  });

  it('refuses a destination that has no USDC account, so it never opens one at Loofta’s cost', async () => {
    const vault = await svc.getOrCreateVault('u2');
    expect(vault.user_wallet).toBe(user.publicKey.toBase58());
    const u2Vault = new (require('@solana/web3.js').PublicKey)(vault.vault_address);
    await mintTo(conn, sponsor, mint, (await getOrCreateAssociatedTokenAccount(conn, sponsor, mint, u2Vault, true)).address, sponsor, 10_000_000n);
    await svc.recordCredit('u2', 'p1', '44444444-4444-4444-8444-444444444444', 10_000_000n);
    await expect(svc.prepareExit('u2', 'org_x', Keypair.generate().publicKey.toBase58())).rejects.toThrow(/no USDC account/);
    expect((await svc.state('u2')).credits).toEqual([{ partner_id: 'p1', usdc: 10 }]);
  });
});
