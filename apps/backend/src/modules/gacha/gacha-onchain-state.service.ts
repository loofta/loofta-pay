import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnchorProvider, Program, type Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import gacha_room_state_idl from './idl/gacha_room_state.json';

const ROOM_PDA_SEED = Buffer.from('gacha-room');

// Standard (non-Private) MagicBlock ephemeral rollup flow — no TEE auth token, no burner keypair
// signing dance. That machinery (see claims.service.ts's getEphemeralConnectionForBurner) exists
// specifically for the Private ER payments need privacy for; gacha's ready/vote state has none —
// it's already broadcast room-wide over plain sockets today — so this is a fully independent,
// standalone connection layer, not modeled on the payments one. See the plan doc and
// .agents/skills/magicblock/typescript-setup.md for the confirmed mechanics this mirrors.
const DEFAULT_BASE_RPC = 'https://rpc.magicblock.app/devnet';
const DEFAULT_ROUTER_ENDPOINT = 'https://devnet-router.magicblock.app/';

interface DelegationStatus {
  isDelegated: boolean;
  fqdn?: string;
}

function popcount(mask: number): number {
  let n = mask, count = 0;
  while (n) { count += n & 1; n >>= 1; }
  return count;
}

export const GACHA_ROOM_PHASE = {
  WAITING: 0,
  PURCHASING: 1,
  OPENING: 2,
  EXCLUDING: 3,
  VOTING: 4,
  SETTLING: 5,
  SETTLED: 6,
  FAILED: 7,
  CANCELLED: 8,
} as const;

export type GachaRoomPhase = typeof GACHA_ROOM_PHASE[keyof typeof GACHA_ROOM_PHASE];

function seatMask(seatNumbers: number[]): number {
  return seatNumbers.reduce((mask, seat) => mask | (1 << (seat - 1)), 0);
}

/** Minimal Anchor `Wallet` adapter around a raw `Keypair` — same shape as GachaVrfService's and
 *  GiveawayVrfService's, deliberately duplicated rather than shared (see gacha-vrf.service.ts's
 *  own comment on why these small per-feature adapters aren't a shared abstraction here). */
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
 * On-chain replacement for GachaGateway's in-memory `readyByRoom` and GachaService's `voteByRoom`
 * — a per-room PDA delegated to a MagicBlock Ephemeral Rollup so mark_ready/cast_vote writes are
 * atomic (Solana's own per-account transaction sequencing) and survive a backend restart or a
 * second instance, instead of JS `Map`s that don't. Gacha is devnet-only end to end, same posture
 * as GachaVrfService.
 *
 * Ready-state (Phase 1) is gated behind GACHA_ONCHAIN_READY_STATE, vote tallies (Phase 2) behind
 * GACHA_ONCHAIN_VOTE_STATE — see gacha.gateway.ts / gacha.service.ts respectively. Each flag can
 * be flipped independently.
 *
 * IMPORTANT (see the plan doc's "Confirmed operational gotcha" section): the deployed ephemeral
 * rollup caches this program's bytecode the first time it's referenced and does NOT pick up later
 * base-layer upgrades to the same program id — confirmed by direct testing, not documented by
 * MagicBlock. Any future instruction change here needs a fresh program id (new keypair,
 * `declare_id!`, Anchor.toml, and the committed IDL), not an in-place upgrade, or new instructions
 * will silently fail on the ER with `InstructionFallbackNotFound` while looking fine on base layer.
 */
@Injectable()
export class GachaOnchainStateService {
  private readonly logger = new Logger(GachaOnchainStateService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Devnet-only program id — env-driven (GACHA_ROOM_STATE_PROGRAM_ID) rather than a compiled
   * constant, since this id changes on every redeploy forced by the ER bytecode-caching
   * constraint documented above the class (each redeploy needs a fresh id — a new devnet key
   * rotation, not just an authority change, forces this too). Falls back to the committed IDL's
   * address so nothing breaks for anyone who hasn't set the env var yet.
   */
  private getProgramId(): PublicKey {
    const fromEnv = this.config.get<string>('GACHA_ROOM_STATE_PROGRAM_ID');
    return new PublicKey(fromEnv || gacha_room_state_idl.address);
  }

  private getBaseConnection(): Connection {
    const rpc = this.config.get<string>('MAGICBLOCK_BASE_RPC_URL') || DEFAULT_BASE_RPC;
    return new Connection(rpc, 'confirmed');
  }

  private async getFeePayerKeypair(): Promise<Keypair> {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58Mod = await import('bs58');
    return Keypair.fromSecretKey(bs58Mod.default.decode(feePayerKey));
  }

  /** sha256(roomId) — same convention as GachaVrfService.deriveSeed / loofta-vrf's
   *  giveaway_id_seed. The program never sees a Postgres UUID directly. */
  deriveSeed(roomId: string): Buffer {
    return createHash('sha256').update(roomId).digest();
  }

  derivePda(roomId: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([ROOM_PDA_SEED, this.deriveSeed(roomId)], this.getProgramId());
  }

  /** Queries the MagicBlock router for this account's delegation status — `isDelegated: true` +
   *  `fqdn` means the account currently lives on that ephemeral rollup; reads/writes belong there,
   *  not on base layer. Never throws; treats a router error as "not delegated" so callers fall
   *  back to base-layer behavior rather than hard-failing on a router blip. */
  async getDelegationStatus(pda: PublicKey): Promise<DelegationStatus> {
    const routerEndpoint = (this.config.get<string>('MAGICBLOCK_ROUTER_URL') || DEFAULT_ROUTER_ENDPOINT).replace(/\/+$/, '');
    try {
      // Match @magicblock-labs/ephemeral-rollups-sdk's ConnectionMagicRouter implementation:
      // it posts getDelegationStatus to `${router}/getDelegationStatus`, not the router root.
      const res = await fetch(`${routerEndpoint}/getDelegationStatus`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getDelegationStatus', params: [pda.toBase58()] }),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error.message);
      return body.result as DelegationStatus;
    } catch (e: any) {
      this.logger.warn(`[GachaOnchainState] router getDelegationStatus failed for ${pda.toBase58()}: ${e.message}`);
      return { isDelegated: false };
    }
  }

  private program(connection: Connection, feePayer: Keypair): Program {
    const provider = new AnchorProvider(connection, new KeypairWallet(feePayer), { commitment: 'confirmed' });
    // Clone with the env-driven address rather than passing the imported IDL straight through —
    // same reasoning as GiveawayVrfService.program(): without this, a future redeploy that
    // updates GACHA_ROOM_STATE_PROGRAM_ID but forgets to regenerate this committed IDL file would
    // have PDA derivation (getProgramId(), already env-driven) pointing at the new program while
    // this client still silently targets the old one. NOTE: this only fixes the top-level address
    // — it does NOT fix delegate_room's nested `owner_program` self-reference (see that account's
    // hardcoded address in the IDL), which Anchor bakes in from the program's own declare_id! at
    // IDL-build time and can only be corrected by regenerating the IDL, not by overriding a string
    // here. The committed IDL must still be regenerated (`anchor idl build`) on every redeploy.
    const idlForCurrentProgram = { ...gacha_room_state_idl, address: this.getProgramId().toBase58() };
    return new Program(idlForCurrentProgram as never, provider);
  }

  /** Resolves the ER connection + Anchor client for an already-delegated room in one call — every
   *  ER-side instruction (mark_ready, the vote instructions) needs exactly this. Throws if the
   *  room isn't currently delegated, since none of these calls have a base-layer fallback. */
  private async erContext(roomPda: PublicKey): Promise<{ connection: Connection; program: Program; feePayer: Keypair }> {
    const status = await this.getDelegationStatus(roomPda);
    if (!status.isDelegated || !status.fqdn) {
      throw new Error(`Room state account ${roomPda.toBase58()} is not currently delegated to an ephemeral rollup`);
    }
    const connection = new Connection(status.fqdn, 'confirmed');
    const feePayer = await this.getFeePayerKeypair();
    return { connection, program: this.program(connection, feePayer), feePayer };
  }

  /** Signs with `feePayer` and sends directly against `connection` (base layer or the resolved ER
   *  endpoint, whichever the caller has already picked) — `skipPreflight: true` throughout, per
   *  the MagicBlock skill's own guidance (ER handles validation; base-layer sends also skip it
   *  here for symmetry and because these are always well-formed program-generated instructions,
   *  not user input). */
  private async send(connection: Connection, tx: Transaction, feePayer: Keypair): Promise<string> {
    tx.feePayer = feePayer.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.sign(feePayer);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    // confirmTransaction resolves once the tx reaches the requested commitment level
    // REGARDLESS of whether it executed successfully — a transaction that aborted with a program
    // error still gets confirmed with that error attached in `value.err`. Not checking this meant
    // every failed on-chain instruction (a validation `require!` rejecting, for instance) looked
    // exactly like success to every caller — confirmed live while building Phase 2's vote
    // instructions: rejected calls (wrong seat, round not over yet, already finalized) were
    // silently "succeeding" with zero state change, which would have made every one of this
    // service's validation guards a no-op in production.
    const confirmation = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`Transaction ${sig} failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
    }
    return sig;
  }

  /** Base layer: creates + delegates a room's tally PDA. Called once, right after a new
   *  `gacha_rooms` row is created — mirrors GachaVrfService's request/derive shape but this is a
   *  two-instruction setup (init, then delegate) rather than a single call. */
  async initAndDelegateRoom(roomId: string, seats: number): Promise<void> {
    const connection = this.getBaseConnection();
    const feePayer = await this.getFeePayerKeypair();
    const program = this.program(connection, feePayer);
    const seed = this.deriveSeed(roomId);
    const [roomPda] = this.derivePda(roomId);

    const initTx = await program.methods
      .initRoom(Array.from(seed), seats)
      .accounts({ payer: feePayer.publicKey })
      .transaction();
    await this.send(connection, initTx, feePayer);

    const delegateTx = await program.methods
      .delegateRoom(Array.from(seed))
      .accounts({ payer: feePayer.publicKey })
      .transaction();
    await this.send(connection, delegateTx, feePayer);

    this.logger.log(`[GachaOnchainState] room ${roomId}: initialized + delegated (pda=${roomPda.toBase58()}, seats=${seats})`);
  }

  /** Lazily creates + delegates a room's state account the first time anything needs it, instead
   *  of requiring a dedicated hook into room creation (gacha.service.ts's findOrCreateWaitingRoom)
   *  — keeps Phase 1's diff contained to the gateway. A no-op if the account is already delegated,
   *  or already exists on base layer (e.g. a concurrent caller's init raced this one — Anchor's
   *  own `init` constraint would reject a second create, so this check-then-create has a narrow
   *  TOCTOU window that's harmless: the loser's initAndDelegateRoom call just fails and is logged,
   *  never silently double-applied, since `init` can't succeed twice for the same PDA). */
  async ensureRoomDelegated(roomId: string, seats: number): Promise<void> {
    const [roomPda] = this.derivePda(roomId);
    const status = await this.getDelegationStatus(roomPda);
    if (status.isDelegated) return;
    const existing = await this.getBaseConnection().getAccountInfo(roomPda).catch(() => null);
    if (existing) {
      await this.delegateExistingRoom(roomId);
      return;
    }
    try {
      await this.initAndDelegateRoom(roomId, seats);
    } catch (e) {
      // A concurrent ready/vote request may have won the create/delegate race. Re-read the
      // router/base state before surfacing an error so the losing request remains idempotent.
      const after = await this.getDelegationStatus(roomPda);
      if (after.isDelegated) return;
      const createdByPeer = await this.getBaseConnection().getAccountInfo(roomPda).catch(() => null);
      if (!createdByPeer) throw e;
      await this.delegateExistingRoom(roomId);
    }
  }

  /** Recovers a room whose base account was initialized but whose delegation transaction failed
   *  (or was interrupted by a process restart). Active callers need the account in the ER; simply
   *  returning on "exists but not delegated" permanently stranded ready/vote state. */
  private async delegateExistingRoom(roomId: string): Promise<void> {
    const connection = this.getBaseConnection();
    const feePayer = await this.getFeePayerKeypair();
    const program = this.program(connection, feePayer);
    const seed = this.deriveSeed(roomId);
    const [roomPda] = this.derivePda(roomId);
    try {
      const tx = await program.methods
        .delegateRoom(Array.from(seed))
        .accounts({ payer: feePayer.publicKey })
        .transaction();
      await this.send(connection, tx, feePayer);
      this.logger.log(`[GachaOnchainState] room ${roomId}: recovered delegation (pda=${roomPda.toBase58()})`);
    } catch (e) {
      const after = await this.getDelegationStatus(roomPda);
      if (!after.isDelegated) throw e;
    }
  }

  /** Ephemeral rollup: marks a seat ready. Idempotent on-chain (see the program's own comment) —
   *  safe to call again if a client retries after a dropped ack. */
  async markReady(roomId: string, seatNumber: number): Promise<void> {
    const [roomPda] = this.derivePda(roomId);
    const { connection, program, feePayer } = await this.erContext(roomPda);
    const tx = await program.methods
      .markReady(seatNumber)
      .accounts({ room: roomPda, authority: feePayer.publicKey })
      .transaction();
    await this.send(connection, tx, feePayer);
  }

  /** Ephemeral rollup: compact room phase for realtime gameplay UI. This intentionally mirrors
   *  only the phase, not heavy DB/API payloads such as NFT metadata. */
  async setPhase(roomId: string, phase: GachaRoomPhase): Promise<void> {
    const [roomPda] = this.derivePda(roomId);
    const { connection, program, feePayer } = await this.erContext(roomPda);
    const tx = await program.methods
      .setPhase(phase)
      .accounts({ room: roomPda, authority: feePayer.publicKey })
      .transaction();
    await this.send(connection, tx, feePayer);
  }

  /** Ephemeral rollup: records the first VRF exclusion result as a bitmask. */
  async recordInitialExclusion(roomId: string, excludedSeatNumbers: number[]): Promise<void> {
    const [roomPda] = this.derivePda(roomId);
    const { connection, program, feePayer } = await this.erContext(roomPda);
    const tx = await program.methods
      .recordInitialExclusion(seatMask(excludedSeatNumbers))
      .accounts({ room: roomPda, authority: feePayer.publicKey })
      .transaction();
    await this.send(connection, tx, feePayer);
  }

  /** Ephemeral rollup: starts (or restarts, for the next round) a vote round — mirrors
   *  GachaService.startVoteRound. `survivorSeatNumbers` are computed off-chain from Postgres
   *  (gacha_room_participants.excluded), same as today's JS version. */
  async startVoteRound(roomId: string, round: number, survivorSeatNumbers: number[]): Promise<void> {
    const [roomPda] = this.derivePda(roomId);
    const { connection, program, feePayer } = await this.erContext(roomPda);
    const survivorMask = survivorSeatNumbers.reduce((mask, seat) => mask | (1 << (seat - 1)), 0);
    const tx = await program.methods
      .startVoteRound(round, survivorMask)
      .accounts({ room: roomPda, authority: feePayer.publicKey })
      .transaction();
    await this.send(connection, tx, feePayer);
  }

  /** Ephemeral rollup: records the extra seat cut by a passed vote round. */
  async recordVoteCut(roomId: string, round: number, seatNumber: number): Promise<void> {
    const [roomPda] = this.derivePda(roomId);
    const { connection, program, feePayer } = await this.erContext(roomPda);
    const tx = await program.methods
      .recordVoteCut(round, seatNumber)
      .accounts({ room: roomPda, authority: feePayer.publicKey })
      .transaction();
    await this.send(connection, tx, feePayer);
  }

  /** Ephemeral rollup: casts (or changes) one seat's vote for the current round. Real atomicity
   *  fix for the race `withVoteLock` used to patch — see the program's own comment. */
  async castVote(roomId: string, seatNumber: number, vote: boolean): Promise<void> {
    const [roomPda] = this.derivePda(roomId);
    const { connection, program, feePayer } = await this.erContext(roomPda);
    const tx = await program.methods
      .castVote(seatNumber, vote)
      .accounts({ room: roomPda, authority: feePayer.publicKey })
      .transaction();
    await this.send(connection, tx, feePayer);
  }

  /** Ephemeral rollup: closes out the current round (see the program's own comment for why no
   *  separate "auto-vote NO for stragglers" step is needed). Idempotent — safe to call from both
   *  the cron sweep and a client-triggered check racing each other. Throws if the round genuinely
   *  isn't over yet (not every survivor has voted and the 30s deadline hasn't passed) — callers
   *  should treat that as "nothing to do yet", not a real error. */
  async finalizeVoteRound(roomId: string): Promise<void> {
    const [roomPda] = this.derivePda(roomId);
    const { connection, program, feePayer } = await this.erContext(roomPda);
    const tx = await program.methods
      .finalizeVoteRound()
      .accounts({ room: roomPda, authority: feePayer.publicKey })
      .transaction();
    await this.send(connection, tx, feePayer);
  }

  /** Reads the current vote tally. Returns null if the room's state account isn't readable yet
   *  (mirrors getReadyState). `passed` replicates gacha.service.ts's existing tie-counts-as-YES
   *  rule exactly (`yesCount * 2 >= totalCount`) — computed here in TS from the raw masks rather
   *  than on-chain, since finalize_vote_round only gates *whether* the round can close, not the
   *  pass/fail decision itself (see the program's own comment). */
  async getVoteState(roomId: string): Promise<{
    round: number; finalized: boolean; yesCount: number; totalCount: number; votedCount: number; passed: boolean; roundDeadline: number;
  } | null> {
    const [roomPda] = this.derivePda(roomId);
    const status = await this.getDelegationStatus(roomPda);
    const connection = status.isDelegated && status.fqdn ? new Connection(status.fqdn, 'confirmed') : this.getBaseConnection();
    const feePayer = await this.getFeePayerKeypair();
    const program = this.program(connection, feePayer);

    try {
      const account = await (program.account as never as Record<string, { fetch: (pda: PublicKey) => Promise<{
        voteRound: number; survivorMask: number; votedMask: number; yesMask: number; finalized: boolean; roundDeadline: unknown;
      }> }>)['gachaRoomState'].fetch(roomPda);
      const totalCount = popcount(account.survivorMask);
      const yesCount = popcount(account.yesMask & account.survivorMask);
      const votedCount = popcount(account.votedMask & account.survivorMask);
      return {
        round: account.voteRound,
        finalized: account.finalized,
        yesCount,
        totalCount,
        votedCount,
        passed: totalCount > 1 && yesCount * 2 >= totalCount,
        roundDeadline: Number(account.roundDeadline),
      };
    } catch (e) {
      this.logger.debug(`[GachaOnchainState] room ${roomId}: state account not yet readable: ${String(e)}`);
      return null;
    }
  }

  /** Reads the current ready_mask + seats — resolves the right connection (ER if delegated, base
   *  layer otherwise) itself so callers don't need to know which. Returns null if the room's
   *  state account doesn't exist yet (e.g. called before initAndDelegateRoom has run). */
  async getReadyState(roomId: string): Promise<{ readyMask: number; seats: number } | null> {
    const [roomPda] = this.derivePda(roomId);
    const status = await this.getDelegationStatus(roomPda);
    const connection = status.isDelegated && status.fqdn ? new Connection(status.fqdn, 'confirmed') : this.getBaseConnection();
    const feePayer = await this.getFeePayerKeypair();
    const program = this.program(connection, feePayer);

    try {
      const account = await (program.account as never as Record<string, { fetch: (pda: PublicKey) => Promise<{ readyMask: number; seats: number }> }>)['gachaRoomState'].fetch(roomPda);
      return { readyMask: account.readyMask, seats: account.seats };
    } catch (e) {
      this.logger.debug(`[GachaOnchainState] room ${roomId}: state account not yet readable: ${String(e)}`);
      return null;
    }
  }

  /** Ephemeral rollup: commits the final tally and hands the PDA back to base-layer ownership.
   *  Called once per room, at settlement. This PDA holds no funds — the rent-exempt balance
   *  itself isn't reclaimed here (see the program's own comment); that'd be a separate,
   *  ordinary base-layer account-close, not implemented yet since it's a minor cost saving, not
   *  a correctness requirement. */
  async undelegateRoom(roomId: string): Promise<void> {
    const [roomPda] = this.derivePda(roomId);
    const status = await this.getDelegationStatus(roomPda);
    if (!status.isDelegated || !status.fqdn) return; // already undelegated (or never delegated) — nothing to do
    const connection = new Connection(status.fqdn, 'confirmed');
    const feePayer = await this.getFeePayerKeypair();
    const program = this.program(connection, feePayer);

    const tx = await program.methods
      .undelegateRoom()
      .accounts({ room: roomPda, authority: feePayer.publicKey })
      .transaction();
    await this.send(connection, tx, feePayer);
    this.logger.log(`[GachaOnchainState] room ${roomId}: undelegated`);
  }
}
