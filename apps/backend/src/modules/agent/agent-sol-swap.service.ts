import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { SendPaymentEncryptionService } from '../send-payment/encryption.service';
import { AutopaySignerService } from '../twitter-autopay/autopay-signer.service';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WSOL = 'So11111111111111111111111111111111111111112';
const JUP = 'https://api.jup.ag/swap/v1';
/** Loofta's cut of a swap, taken from the USDC out (same 0.80% as in-app swaps). */
const FEE_BPS = 80;
/** Stays on the burner for network fees and the two small token accounts, and is returned at the end. */
const RESERVE_LAMPORTS = 8_000_000;
/** Below this there is nothing worth swapping (a dust deposit is returned to the person instead). */
export const MIN_SWAP_LAMPORTS = 25_000_000;
const SIGNATURE_FEE = 5_000;

/**
 * Pay with SOL: the person sends SOL to a one-time address only the backend holds, we swap it to USDC with Jupiter
 * and send the USDC to their own Loofta wallet, then return whatever SOL is left. The burner pays all of its own
 * fees and rent, so the sponsored fee payer is never involved, and the destination is read from the person's
 * account, never supplied by an agent. Each step looks at the real balances, so running it again after a crash
 * finishes the job instead of repeating it.
 */
@Injectable()
export class AgentSolSwapService {
  private readonly logger = new Logger(AgentSolSwapService.name);
  private readonly busy = new Set<string>();
  private conn: Connection | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly enc: SendPaymentEncryptionService,
    private readonly signer: AutopaySignerService,
  ) {}

  private get connection() {
    return (this.conn ??= new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed'));
  }

  /** A new one-time address and its encrypted key. */
  newBurner(): { address: string; keyEnc: string } {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    return { address, keyEnc: this.enc.encrypt(Buffer.from(kp.secretKey), address) };
  }

  private keypair(row: any): Keypair {
    const kp = Keypair.fromSecretKey(new Uint8Array(this.enc.decrypt(row.burner_key_enc, row.deposit_address)));
    if (kp.publicKey.toBase58() !== row.deposit_address) throw new Error('Burner key does not match its address');
    return kp;
  }

  private headers() {
    return { 'content-type': 'application/json', 'x-api-key': this.config.get<string>('JUPITER_API_KEY') ?? '' };
  }

  private async usdcBalance(ata: PublicKey): Promise<bigint> {
    try {
      return BigInt((await this.connection.getTokenAccountBalance(ata)).value.amount);
    } catch {
      return 0n; // no account yet
    }
  }

  /**
   * Moves a funding row forward and says what happened: 'waiting' (nothing to do yet), 'received', or 'failed'
   * with the SOL already returned. Never throws for an expected state.
   */
  async settle(row: any): Promise<{ state: 'waiting' | 'received' | 'failed'; usdc?: number; signature?: string; error?: string }> {
    if (this.busy.has(row.id)) return { state: 'waiting' };
    this.busy.add(row.id);
    try {
      const kp = this.keypair(row);
      const burner = kp.publicKey;
      const user = new PublicKey(row.recipient_address);
      const burnerUsdc = getAssociatedTokenAddressSync(USDC_MINT, burner);
      const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, user);

      let usdc = await this.usdcBalance(burnerUsdc);
      let lamports = await this.connection.getBalance(burner);
      if (usdc === 0n && lamports < MIN_SWAP_LAMPORTS) {
        // Nothing, or only dust. Dust is sent on to the person so it is never stranded.
        if (lamports > 0 && lamports < MIN_SWAP_LAMPORTS && Date.now() - new Date(row.created_at).getTime() > 2 * 60 * 60 * 1000) {
          await this.sweepSol(kp, user);
        }
        return { state: 'waiting' };
      }

      let signature: string | undefined;
      if (usdc === 0n) {
        signature = await this.swap(kp, lamports - RESERVE_LAMPORTS);
        usdc = await this.usdcBalance(burnerUsdc);
        if (usdc === 0n) throw new Error('The swap landed but no USDC arrived');
      }

      // Forward every USDC to the person's own wallet, then close the burner's token account.
      const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(burner, userUsdc, user, USDC_MINT),
        createTransferCheckedInstruction(burnerUsdc, USDC_MINT, userUsdc, burner, usdc, 6),
        createCloseAccountInstruction(burnerUsdc, burner, burner),
      );
      const sent = await sendAndConfirmTransaction(this.connection, tx, [kp], { commitment: 'confirmed' });
      await this.sweepSol(kp, user).catch((e) => this.logger.warn(`sweep ${row.id}: ${(e as Error).message}`));
      return { state: 'received', usdc: Number(usdc) / 1e6, signature: signature ?? sent };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn(`SOL swap ${row.id} failed: ${msg}`);
      return { state: 'waiting', error: msg };
    } finally {
      this.busy.delete(row.id);
    }
  }

  /** The swap itself: all but the reserve, SOL to USDC, with Loofta's fee, signed by the burner. */
  private async swap(kp: Keypair, lamportsIn: number): Promise<string> {
    const feePayer = this.signer.feePayerAddress;
    let feeAccount: string | null = null;
    if (feePayer) {
      const ata = getAssociatedTokenAddressSync(USDC_MINT, new PublicKey(feePayer));
      if (await this.connection.getAccountInfo(ata)) feeAccount = ata.toBase58();
    }
    const params = new URLSearchParams({ inputMint: WSOL, outputMint: USDC_MINT.toBase58(), amount: String(lamportsIn), slippageBps: '100' });
    if (feeAccount) params.set('platformFeeBps', String(FEE_BPS));
    const quote = await (await fetch(`${JUP}/quote?${params}`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) })).json();
    if (!quote?.outAmount) throw new Error(`No route: ${JSON.stringify(quote).slice(0, 120)}`);
    const res = await fetch(`${JUP}/swap`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: kp.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 300_000, priorityLevel: 'medium' } },
        ...(feeAccount ? { feeAccount } : {}),
      }),
    });
    const built: any = await res.json();
    if (!built?.swapTransaction) throw new Error(`Could not build the swap: ${JSON.stringify(built).slice(0, 120)}`);
    const tx = VersionedTransaction.deserialize(Buffer.from(built.swapTransaction, 'base64'));
    // Only the burner signs and pays: anything asking for another signer is refused.
    if (tx.message.header.numRequiredSignatures !== 1 || !tx.message.staticAccountKeys[0].equals(kp.publicKey)) throw new Error('Unexpected signer layout in the swap');
    tx.sign([kp]);
    const signature = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    const conf = await this.connection.confirmTransaction({ signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: built.lastValidBlockHeight }, 'confirmed');
    if (conf.value.err) throw new Error('The swap did not confirm');
    return signature;
  }

  /** Everything left on the burner goes to the person's own wallet. */
  async sweepSol(kp: Keypair, to: PublicKey): Promise<void> {
    const lamports = await this.connection.getBalance(kp.publicKey);
    if (lamports <= SIGNATURE_FEE) return;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports: lamports - SIGNATURE_FEE }));
    await sendAndConfirmTransaction(this.connection, tx, [kp], { commitment: 'confirmed' });
  }

  /** Gives the SOL back untouched (the order expired or kept failing). */
  async refund(row: any): Promise<void> {
    await this.sweepSol(this.keypair(row), new PublicKey(row.recipient_address));
  }
}
