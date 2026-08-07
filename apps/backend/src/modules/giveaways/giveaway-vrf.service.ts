import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AnchorProvider, Program, type Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { Giveaway } from './entities/giveaway.entity';
import loofta_vrf_idl from './idl/loofta_vrf.json';

const PROGRAM_ID = new PublicKey(loofta_vrf_idl.address);
const DRAW_PDA_SEED = Buffer.from('draw');

// ephemeral_rollups_sdk::vrf::consts — base-layer oracle queue, shared by devnet and mainnet
// (only localnet uses a distinct DEFAULT_TEST_QUEUE, which giveaways never run on).
const VRF_ORACLE_QUEUE = new PublicKey('Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh');

/** Minimal Anchor `Wallet` adapter around a raw `Keypair` — this repo has no browser wallet
 *  on the backend, and this is the only server-side Anchor `Program` client in the codebase. */
class KeypairWallet implements Wallet {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) tx.partialSign(this.payer);
    else tx.sign([this.payer]);
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

/**
 * On-chain MagicBlock VRF integration for the giveaway random draw. Requests randomness from
 * the base-layer VRF oracle and polls for fulfillment — this is a 100% backend-originated
 * instruction against our own program, so it bypasses `SolanaSponsorService.signAndBroadcast`
 * entirely (that method's ALLOWED_SPONSOR_PROGRAMS whitelist exists to guard against
 * attacker-supplied instructions, a threat model that doesn't apply here).
 */
@Injectable()
export class GiveawayVrfService {
  private readonly logger = new Logger(GiveawayVrfService.name);

  constructor(private readonly solanaSponsor: SolanaSponsorService) {}

  private cluster(giveaway: Giveaway): 'devnet' | 'mainnet' {
    return giveaway.is_devnet ? 'devnet' : 'mainnet';
  }

  /** sha256(giveaway.id) — the program only ever sees stable 32-byte seed bytes, never a
   *  Postgres UUID directly. */
  deriveSeed(giveawayId: string): Buffer {
    return createHash('sha256').update(giveawayId).digest();
  }

  derivePda(giveawayId: string): [PublicKey, number] {
    const seed = this.deriveSeed(giveawayId);
    return PublicKey.findProgramAddressSync([DRAW_PDA_SEED, seed], PROGRAM_ID);
  }

  private program(connection: Connection): Program {
    const feePayer = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayer) throw new Error('GiveawayVrfService: fee payer keypair unavailable');
    const provider = new AnchorProvider(connection, new KeypairWallet(feePayer), { commitment: 'confirmed' });
    return new Program(loofta_vrf_idl as never, provider);
  }

  /** Sends the on-chain `request_randomness` instruction. Re-callable for the same giveaway
   *  (e.g. after a manual stall-recovery retry) — a fresh, unfulfilled request just overwrites
   *  the prior one on-chain. Returns the slot the request was submitted at. */
  async requestRandomness(giveaway: Giveaway): Promise<{ slot: number }> {
    const connection = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
    const program = this.program(connection);
    const seed = this.deriveSeed(giveaway.id);
    const [drawRequestPda] = this.derivePda(giveaway.id);
    const feePayer = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayer) throw new Error('GiveawayVrfService: fee payer keypair unavailable');

    const clientSeed = seed[0]; // any byte of the deterministic seed works as VRF client entropy

    const slot = await connection.getSlot('confirmed');
    await program.methods
      .requestRandomness(Array.from(seed), clientSeed)
      .accounts({
        payer: feePayer.publicKey,
        drawRequest: drawRequestPda,
        oracleQueue: VRF_ORACLE_QUEUE,
      })
      .rpc({ skipPreflight: true });

    this.logger.log(`[GiveawayVrf] ${giveaway.id}: requested randomness (slot=${slot}, pda=${drawRequestPda.toBase58()})`);
    return { slot };
  }

  /** Fetches the on-chain DrawRequest PDA. Returns hex randomness once the oracle callback has
   *  fulfilled it, or null while still pending. */
  async pollFulfillment(giveaway: Giveaway): Promise<string | null> {
    const connection = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
    const program = this.program(connection);
    const [drawRequestPda] = this.derivePda(giveaway.id);

    try {
      const account = await (program.account as never as Record<string, { fetch: (pda: PublicKey) => Promise<{ fulfilled: boolean; randomness: number[] }> }>)['drawRequest'].fetch(
        drawRequestPda,
      );
      if (!account.fulfilled) return null;
      return Buffer.from(account.randomness).toString('hex');
    } catch (e) {
      // Account not found yet (request tx hasn't landed/confirmed) — treat as still pending.
      this.logger.debug(`[GiveawayVrf] ${giveaway.id}: draw request account not yet readable: ${String(e)}`);
      return null;
    }
  }
}
