import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnchorProvider, Program, type Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
// Same generated IDL the giveaways VRF draw uses (programs/loofta-vrf is a single, entity-agnostic
// randomness-request/callback program keyed by an opaque 32-byte seed) — imported from the
// giveaways module rather than duplicated here to keep one source of truth for the program
// interface; not modifying that module at all to avoid any risk to the live giveaways feature.
import loofta_vrf_idl from '../giveaways/idl/loofta_vrf.json';

const PROGRAM_ID = new PublicKey(loofta_vrf_idl.address);
const DRAW_PDA_SEED = Buffer.from('draw');

// ephemeral_rollups_sdk::vrf::consts — base-layer oracle queue, shared by devnet and mainnet.
const VRF_ORACLE_QUEUE = new PublicKey('Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh');

/** Minimal Anchor `Wallet` adapter around a raw `Keypair` — same shape as GiveawayVrfService's,
 *  duplicated rather than shared since it's ~15 lines and the two services deliberately don't
 *  share a Solana connection/cluster source (gacha is hardcoded devnet-only, see gacha.service.ts). */
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
 * On-chain MagicBlock VRF integration for the gacha room exclusion draw — same `loofta-vrf`
 * program and oracle queue the giveaways draw uses, keyed by room id instead of giveaway id.
 * Gacha is devnet-only end to end (see gacha.service.ts), so unlike GiveawayVrfService there's
 * no per-entity cluster switch here.
 */
@Injectable()
export class GachaVrfService {
  private readonly logger = new Logger(GachaVrfService.name);

  constructor(private readonly config: ConfigService) {}

  private async getConnection(): Promise<Connection> {
    const rpc =
      this.config.get<string>('SOLANA_DEVNET_RPC_URL') ||
      (this.config.get<string>('HELIUS_API_KEY')
        ? `https://devnet.helius-rpc.com/?api-key=${this.config.get('HELIUS_API_KEY')}`
        : 'https://api.devnet.solana.com');
    return new Connection(rpc, 'confirmed');
  }

  private async getFeePayerKeypair(): Promise<Keypair> {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58Mod = await import('bs58');
    return Keypair.fromSecretKey(bs58Mod.default.decode(feePayerKey));
  }

  /** sha256("gacha:" + roomId) — the program only ever sees stable 32-byte seed bytes, never a
   *  Postgres UUID directly. The "gacha:" domain prefix means this can never derive the same seed
   *  (and therefore the same draw-request PDA) as GiveawayVrfService.deriveSeed, which shares this
   *  same loofta_vrf program but has no prefix of its own — without it, a gacha roomId and a
   *  giveaway id that happened to be identical strings would collide on the exact same PDA. */
  deriveSeed(roomId: string): Buffer {
    return createHash('sha256').update(`gacha:${roomId}`).digest();
  }

  derivePda(roomId: string): [PublicKey, number] {
    const seed = this.deriveSeed(roomId);
    return PublicKey.findProgramAddressSync([DRAW_PDA_SEED, seed], PROGRAM_ID);
  }

  private async program(connection: Connection, feePayer: Keypair): Promise<Program> {
    const provider = new AnchorProvider(connection, new KeypairWallet(feePayer), { commitment: 'confirmed' });
    return new Program(loofta_vrf_idl as never, provider);
  }

  /** Sends the on-chain `request_randomness` instruction for this room. Re-callable (a fresh,
   *  unfulfilled request just overwrites the prior one on-chain). Returns the slot submitted at. */
  async requestRandomness(roomId: string): Promise<{ slot: number }> {
    const connection = await this.getConnection();
    const feePayer = await this.getFeePayerKeypair();
    const program = await this.program(connection, feePayer);
    const seed = this.deriveSeed(roomId);
    const [drawRequestPda] = this.derivePda(roomId);
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

    this.logger.log(`[GachaVrf] room ${roomId}: requested randomness (slot=${slot}, pda=${drawRequestPda.toBase58()})`);
    return { slot };
  }

  /** Fetches the on-chain DrawRequest PDA. Returns hex randomness once the oracle callback has
   *  fulfilled it, or null while still pending. */
  async pollFulfillment(roomId: string): Promise<string | null> {
    const connection = await this.getConnection();
    const feePayer = await this.getFeePayerKeypair();
    const program = await this.program(connection, feePayer);
    const [drawRequestPda] = this.derivePda(roomId);

    try {
      const account = await (program.account as never as Record<string, { fetch: (pda: PublicKey) => Promise<{ fulfilled: boolean; randomness: number[] }> }>)['drawRequest'].fetch(
        drawRequestPda,
      );
      if (!account.fulfilled) return null;
      return Buffer.from(account.randomness).toString('hex');
    } catch (e) {
      this.logger.debug(`[GachaVrf] room ${roomId}: draw request account not yet readable: ${String(e)}`);
      return null;
    }
  }
}
