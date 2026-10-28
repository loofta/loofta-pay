import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { UsersService } from '@/modules/users/users.service';
import { JupiterSwapDto } from './dto/jupiter-swap.dto';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
// v1's /swap (POST, single quote+build) does not support a custom destination account — Jupiter
// returns NOT_SUPPORTED for nativeDestinationAccount/destinationTokenAccount there. v2's /order
// (GET, quote + assembled tx in one call) supports the same thing via a unified `receiver` param
// that transfers native SOL directly to an arbitrary wallet with no ATA involved.
const JUPITER_API_BASE = 'https://api.jup.ag/swap/v2';
// In-app swaps use Metis (v1): it takes a platform fee into a token account WE own, and the quote's
// outAmount already has the fee taken out. (v2's referral fee needs a hand-made referral account.)
const JUPITER_V1_BASE = 'https://api.jup.ag/swap/v1';
const JUPITER_TOKENS_BASE = 'https://api.jup.ag/tokens/v2';
/** Loofta's cut of every in-app swap: 0.80%, taken from the token the user receives. */
export const SWAP_FEE_BPS = 80;
const MIN_SOL_FOR_SWAP_LAMPORTS = 3_000_000; // 0.003 SOL for network + account rent
const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280;
/** A token must have at least this much liquidity before we open a fee account for it. */
const MIN_LIQUIDITY_FOR_FEE_ACCOUNT_USD = 5_000;
const MAX_NEW_FEE_ACCOUNTS_PER_DAY = 40;

/**
 * SOL gas top-up threshold/amount for a user's own embedded wallet before it signs+pays for its
 * own Jupiter swap. Mirrors offramp.service.ts's ensureBaseGas exactly — a small, unrecovered,
 * one-way sponsorship cost, not a rent payment, so none of the ATA-creation drain-guard machinery
 * in solana-sponsor.service.ts applies here (see solana-sponsor-safety skill: the fee payer never
 * becomes the `payer` on the swap transaction itself, only on this separate plain SOL transfer).
 */
const SOL_GAS_TOPUP_THRESHOLD_LAMPORTS = 3_000_000; // 0.003 SOL
const SOL_GAS_TOPUP_AMOUNT_LAMPORTS = 5_000_000; // 0.005 SOL

/**
 * Stateless by design — no DB table. The completed withdrawal is already recorded in the same
 * `withdrawals` table every other Solana withdrawal uses (BalanceModal.tsx's saveWithdrawalToDB,
 * same destination address field, SOL amount in `estimatedOut`), so a dedicated table here would
 * only have duplicated that. `requestId` just needs to survive the few seconds between /order and
 * /execute, which the browser holding it in state already does — nothing server-side needs it.
 */
@Injectable()
export class JupiterService {
  private readonly logger = new Logger(JupiterService.name);
  private readonly connection: Connection;
  private feePayerKeypair: Keypair | null = null;

  private feeAccountCreations: number[] = [];
  private readonly feeAccountInFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    this.connection = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');

    const pkRaw = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    const pk = typeof pkRaw === 'string' ? pkRaw.trim().replace(/^["']|["']$/g, '') : '';
    if (pk) {
      try {
        const secret = pk.startsWith('[') ? Uint8Array.from(JSON.parse(pk)) : bs58.decode(pk);
        this.feePayerKeypair = Keypair.fromSecretKey(secret);
      } catch (e) {
        this.logger.warn(`Invalid SOLANA_FEE_PAYER_PRIVATE_KEY: ${(e as Error).message}. SOL gas top-up disabled.`);
      }
    } else {
      this.logger.warn('SOLANA_FEE_PAYER_PRIVATE_KEY not set; SOL withdrawal gas top-up disabled.');
    }
  }

  private getApiKey(): string {
    const key = this.config.get<string>('JUPITER_API_KEY');
    if (!key) throw new BadRequestException('Jupiter API is not configured (JUPITER_API_KEY missing)');
    return key;
  }

  // Fund the user's own wallet with a small amount of SOL so it can sign and pay for its own
  // swap transaction — same pattern as offramp.service.ts's ensureBaseGas. A no-op once the
  // wallet already holds enough, so repeated calls cost nothing after the first.
  private async ensureSolGas(address: string): Promise<void> {
    if (!this.feePayerKeypair) return;
    try {
      const balance = await this.connection.getBalance(new PublicKey(address));
      if (balance >= SOL_GAS_TOPUP_THRESHOLD_LAMPORTS) return;
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.feePayerKeypair.publicKey,
          toPubkey: new PublicKey(address),
          lamports: SOL_GAS_TOPUP_AMOUNT_LAMPORTS,
        }),
      );
      const sig = await sendAndConfirmTransaction(this.connection, tx, [this.feePayerKeypair], { commitment: 'confirmed' });
      this.logger.log(`Gas top-up sent to ${address.slice(0, 8)}…: ${sig}`);
    } catch (e: any) {
      this.logger.warn(`ensureSolGas failed for ${address}: ${e.message}`);
    }
  }

  // GET /order: quote + a ready-to-sign assembled transaction in one call. `receiver` delivers
  // native SOL straight to an arbitrary wallet (no ATA, no separate transfer step needed).
  private async getOrder(amountAtomicUsdc: bigint, taker: string, receiver: string): Promise<any> {
    const params = new URLSearchParams({
      inputMint: USDC_MINT,
      outputMint: WSOL_MINT,
      amount: amountAtomicUsdc.toString(),
      taker,
      receiver,
      slippageBps: '100',
    });
    const res = await fetch(`${JUPITER_API_BASE}/order?${params.toString()}`, {
      headers: { 'x-api-key': this.getApiKey() },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Jupiter order failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const order = await res.json();
    if (!order.transaction) {
      throw new BadRequestException(order.errorMessage || 'Jupiter did not return a transaction to sign');
    }
    return order;
  }

  /**
   * Quote + assembled unsigned USDC -> native SOL swap transaction, delivered straight to
   * `destinationAddress`. Tops up the user's own wallet with just enough SOL to sign and pay for
   * its own swap first (never our fee payer — see module header).
   */
  async prepareSolWithdrawal(solanaAddress: string, destinationAddress: string, amountUSDC: number) {
    let destPubkey: PublicKey;
    let senderPubkey: PublicKey;
    try {
      destPubkey = new PublicKey(destinationAddress);
      senderPubkey = new PublicKey(solanaAddress);
    } catch {
      throw new BadRequestException('Invalid Solana address');
    }
    if (destPubkey.equals(senderPubkey)) {
      throw new BadRequestException('Destination must be different from your own wallet');
    }

    await this.ensureSolGas(solanaAddress);

    const amountAtomicUsdc = BigInt(Math.round(amountUSDC * 1_000_000));
    const order = await this.getOrder(amountAtomicUsdc, senderPubkey.toBase58(), destPubkey.toBase58());

    return {
      swapTransactionBase64: order.transaction as string,
      requestId: order.requestId as string,
      estimatedSolOut: Number(order.outAmount ?? 0) / 1_000_000_000,
    };
  }

  /** Submits the user-signed transaction to Jupiter, which broadcasts and confirms it. */
  async executeSwap(requestId: string, signedTransactionBase64: string) {
    const res = await fetch(`${JUPITER_API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.getApiKey() },
      body: JSON.stringify({ signedTransaction: signedTransactionBase64, requestId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Jupiter execute failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const result = await res.json();
    if (result.status !== 'Success') {
      throw new BadRequestException(result.error || 'Swap failed to land on-chain');
    }
    return { status: 'COMPLETE', signature: result.signature as string };
  }

  // ───────────────────────── In-app token swaps (Metis v1, 0.80% platform fee) ─────────────────────────

  private async decimalsOf(mint: PublicKey): Promise<number> {
    const info = await this.connection.getAccountInfo(mint);
    if (!info) throw new BadRequestException('Unknown token');
    return (await getMint(this.connection, mint, 'confirmed', info.owner)).decimals;
  }

  private toBaseUnits(amount: string, decimals: number): bigint {
    const [whole, frac = ''] = amount.split('.');
    if (frac.length > decimals) throw new BadRequestException(`This token supports at most ${decimals} decimal places.`);
    const v = BigInt(whole + frac.padEnd(decimals, '0'));
    if (v <= 0n) throw new BadRequestException('Invalid amount');
    return v;
  }

  private async v1Quote(dto: JupiterSwapDto, inDecimals: number): Promise<any> {
    const params = new URLSearchParams({
      inputMint: dto.inputMint,
      outputMint: dto.outputMint,
      amount: this.toBaseUnits(dto.amount, inDecimals).toString(),
      slippageBps: String(dto.slippageBps ?? 100),
      platformFeeBps: String(SWAP_FEE_BPS),
    });
    const res = await fetch(`${JUPITER_V1_BASE}/quote?${params.toString()}`, { headers: { 'x-api-key': this.getApiKey() } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`No route found for that swap (${res.status}): ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  private assertSwapPair(dto: JupiterSwapDto) {
    if (dto.inputMint === dto.outputMint) throw new BadRequestException('Pick two different tokens.');
  }

  /** Quote shown while the user types. The returned outAmount is already net of the 0.80% fee. */
  async quoteSwap(userId: string, dto: JupiterSwapDto) {
    this.assertSwapPair(dto);
    const outMint = new PublicKey(dto.outputMint);
    const inDecimals = await this.decimalsOf(new PublicKey(dto.inputMint));
    const outDecimals = await this.decimalsOf(outMint);
    const q = await this.v1Quote(dto, inDecimals);

    // Estimated cost to the user in SOL: signature + typical priority fee, plus one-time account rent
    // when they do not hold the token they are buying yet (receiving native SOL needs no account).
    let needsAccountRent = false;
    if (dto.outputMint !== WSOL_MINT) {
      try {
        const wallet = new PublicKey(await this.usersService.getSolanaWalletAddress(userId));
        needsAccountRent = !(await this.connection.getAccountInfo(await getAssociatedTokenAddress(outMint, wallet)));
      } catch { /* leave false: the estimate just omits rent */ }
    }
    const networkFeeLamports = 5_000 + 150_000 + (needsAccountRent ? TOKEN_ACCOUNT_RENT_LAMPORTS : 0);

    return {
      networkFeeLamports,
      needsAccountRent,
      inAmount: String(q.inAmount),
      outAmount: String(q.outAmount),
      minOutAmount: String(q.otherAmountThreshold),
      feeBps: SWAP_FEE_BPS,
      feeAmount: String(q.platformFee?.amount ?? '0'),
      priceImpactPct: Number(q.priceImpactPct ?? 0),
      inDecimals,
      outDecimals,
    };
  }

  /**
   * Builds the user's swap transaction. The fee payer never signs it: the user is the only required
   * signer and pays the network fee in SOL. The fee payer's only involvement is opening ITS OWN token
   * account for the output mint (that is where the 0.80% lands), gated by liquidity and a daily cap.
   */
  async buildSwap(userId: string, dto: JupiterSwapDto) {
    this.assertSwapPair(dto);
    const userWallet = await this.usersService.getSolanaWalletAddress(userId);
    const userPk = new PublicKey(userWallet);
    const outMint = new PublicKey(dto.outputMint);

    const outInfo = await this.connection.getAccountInfo(outMint);
    if (!outInfo || !outInfo.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new BadRequestException('That token is not supported for in-app swaps yet.');
    }
    if ((await this.connection.getBalance(userPk)) < MIN_SOL_FOR_SWAP_LAMPORTS) {
      throw new BadRequestException('You need about 0.003 SOL in your wallet for the network fee.');
    }

    const inDecimals = await this.decimalsOf(new PublicKey(dto.inputMint));
    const feeAccount = await this.ensureFeeTokenAccount(outMint, userId);
    const quote = await this.v1Quote(dto, inDecimals);

    const res = await fetch(`${JUPITER_V1_BASE}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.getApiKey() },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: userWallet,
        feeAccount,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 500_000, priorityLevel: 'medium' } },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Could not build the swap (${res.status}): ${body.slice(0, 200)}`);
    }
    const built = (await res.json()) as { swapTransaction?: string; lastValidBlockHeight?: number };
    if (!built.swapTransaction) throw new BadRequestException('Jupiter did not return a transaction to sign');

    // Safety: the user must be the one and only signer and the fee payer of what they are asked to sign.
    const tx = VersionedTransaction.deserialize(Buffer.from(built.swapTransaction, 'base64'));
    if (tx.message.header.numRequiredSignatures !== 1 || !tx.message.staticAccountKeys[0].equals(userPk)) {
      this.logger.error(`[JupiterSwap] unexpected signer layout for user ${userId}; refusing`);
      throw new BadRequestException('Could not build a safe swap transaction. Try again.');
    }

    const outDecimals = await this.decimalsOf(outMint);
    return {
      swapTransaction: built.swapTransaction,
      lastValidBlockHeight: built.lastValidBlockHeight ?? null,
      inAmount: String(quote.inAmount),
      outAmount: String(quote.outAmount),
      minOutAmount: String(quote.otherAmountThreshold),
      feeBps: SWAP_FEE_BPS,
      feeAmount: String(quote.platformFee?.amount ?? '0'),
      outDecimals,
    };
  }

  /** The fee payer's own token account for `mint`, created once (idempotent), where the 0.80% is paid. */
  private async ensureFeeTokenAccount(mint: PublicKey, userId: string): Promise<string> {
    if (!this.feePayerKeypair) throw new ServiceUnavailableException('In-app swaps are temporarily unavailable.');
    const owner = this.feePayerKeypair.publicKey;
    const ata = await getAssociatedTokenAddress(mint, owner);
    if (await this.connection.getAccountInfo(ata)) return ata.toBase58();

    const key = mint.toBase58();
    let pending = this.feeAccountInFlight.get(key);
    if (!pending) {
      await this.assertTokenWorthAFeeAccount(key);
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      this.feeAccountCreations = this.feeAccountCreations.filter((t) => t > cutoff);
      if (this.feeAccountCreations.length >= MAX_NEW_FEE_ACCOUNTS_PER_DAY) {
        this.logger.warn(`[JupiterSwap] fee-account daily cap hit, refusing mint=${key} user=${userId}`);
        throw new ServiceUnavailableException('Swaps into new tokens are busy right now. Try again later.');
      }
      this.feeAccountCreations.push(Date.now());
      const payer = this.feePayerKeypair;
      pending = (async () => {
        const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, mint));
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.feePayer = payer.publicKey;
        tx.sign(payer);
        const sig = await this.connection.sendRawTransaction(tx.serialize());
        await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        this.logger.log(`SPONSOR_FEE_ACCOUNT_CREATE user=${userId} mint=${key} owner=feePayer(self) sig=${sig.slice(0, 12)}…`);
      })().finally(() => this.feeAccountInFlight.delete(key));
      this.feeAccountInFlight.set(key, pending);
    }
    try {
      await pending;
    } catch (e) {
      this.logger.warn(`[JupiterSwap] fee account create failed mint=${key}: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException('Swaps into this token are unavailable right now.');
    }
    return ata.toBase58();
  }

  private async assertTokenWorthAFeeAccount(mint: string): Promise<void> {
    try {
      const res = await fetch(`${JUPITER_TOKENS_BASE}/search?query=${mint}`, { headers: { 'x-api-key': this.getApiKey() }, signal: AbortSignal.timeout(5_000) });
      const list = (await res.json()) as Array<{ id?: string; liquidity?: number; usdPrice?: number }>;
      const t = Array.isArray(list) ? list.find((x) => x.id === mint) : undefined;
      if (t && Number(t.usdPrice) > 0 && Number(t.liquidity) >= MIN_LIQUIDITY_FOR_FEE_ACCOUNT_USD) return;
    } catch { /* fall through */ }
    throw new BadRequestException('That token has too little liquidity to swap into here.');
  }
}
