import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { createHash, createPublicKey, randomUUID, verify as cryptoVerify } from 'crypto';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { UsersService } from '@/modules/users/users.service';
import { JupiterSwapDto, JupiterSwapSubmitDto } from './dto/jupiter-swap.dto';
import { fetchSolPriceUsd } from '@/common/magicblock-private-transfer';

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
const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const JUPITER_V6_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
// Gasless swaps: the fee payer pays the network fee and any new token-account rent, and the cost is
// priced into the swap fee. Every constant below is a guard against that being turned into a drain.
const MIN_FEE_BPS = SWAP_FEE_BPS;
const COST_RECOVERY_BUFFER = 1.25; // the network cost we charge is 1.25x what we pay, same buffer as ata-rent-recovery
const USDC_DECIMALS = 6;
const PRIORITY_FEE_CAP_LAMPORTS = 100_000;
const SIGNATURE_FEE_LAMPORTS = 5_000;
const PENDING_TTL_MS = 60_000; // a Solana blockhash only lives about this long anyway
const MAX_SPONSORED_SWAPS_PER_USER_PER_DAY = 30;
const FEE_PAYER_RESERVE_LAMPORTS = 300_000_000; // never sponsor below 0.3 SOL left in the fee payer
const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280;
const MIN_SOL_FOR_SWAP_LAMPORTS = 3_000_000; // 0.003 SOL: what a swap needs when the user pays its own network fee

type PendingSwap = { userId: string; messageHash: string; expiresAt: number; lastValidBlockHeight: number; costLamports: number };
type JupIx = { programId: string; accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>; data: string };
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

  private readonly pendingSwaps = new Map<string, PendingSwap>();
  private readonly swapsByUserDay = new Map<string, number>();
  private spendDay = '';
  private spendLamportsToday = 0;
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

  private assertSwapPair(dto: JupiterSwapDto) {
    if (dto.inputMint === dto.outputMint) throw new BadRequestException('Pick two different tokens.');
  }

  private gaslessEnabled(): boolean {
    return (this.config.get<string>('JUPITER_GASLESS_ENABLED') ?? 'true') !== 'false';
  }

  private dailyBudgetLamports(): number {
    const sol = Number(this.config.get<string>('JUPITER_SPONSOR_DAILY_BUDGET_SOL') ?? '0.5');
    return Math.round((Number.isFinite(sol) && sol > 0 ? sol : 0.5) * 1e9);
  }

  /** Costs we pay per swap, in lamports: both signatures, a capped priority fee and rent for each new token account. */
  private estimateCostLamports(ataCount: number, priorityLamports = PRIORITY_FEE_CAP_LAMPORTS): number {
    return 2 * SIGNATURE_FEE_LAMPORTS + priorityLamports + ataCount * TOKEN_ACCOUNT_RENT_LAMPORTS;
  }

  /**
   * What a sponsored swap costs us, charged to the user in USDC out of the amount they swap (no minimum
   * swap: any amount above this cost works): both signatures, a capped priority fee and rent for each
   * token account we open, with a 25% buffer. USDC is treated as $1.
   */
  private costFeeUsdcUnits(ataCount: number, solUsd: number, priorityLamports = PRIORITY_FEE_CAP_LAMPORTS): bigint {
    const usd = (this.estimateCostLamports(ataCount, Math.min(priorityLamports, PRIORITY_FEE_CAP_LAMPORTS)) / 1e9) * solUsd * COST_RECOVERY_BUFFER;
    return BigInt(Math.ceil(usd * 10 ** USDC_DECIMALS));
  }

  private costTooHigh(total: bigint, cost: bigint): BadRequestException {
    return new BadRequestException(`Swap more than the network cost of $${(Number(cost) / 10 ** USDC_DECIMALS).toFixed(2)}.`);
  }

  private async v1Quote(dto: JupiterSwapDto, inDecimals: number, feeBps: number, amountBase?: bigint): Promise<any> {
    const params = new URLSearchParams({
      inputMint: dto.inputMint,
      outputMint: dto.outputMint,
      amount: (amountBase ?? this.toBaseUnits(dto.amount, inDecimals)).toString(),
      slippageBps: String(dto.slippageBps ?? 50),
      platformFeeBps: String(feeBps),
    });
    const res = await fetch(`${JUPITER_V1_BASE}/quote?${params.toString()}`, { headers: { 'x-api-key': this.getApiKey() } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`No route found for that swap (${res.status}): ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  private async missingOutputAtaCount(userPk: PublicKey, outMint: PublicKey): Promise<number> {
    try {
      return (await this.connection.getAccountInfo(await getAssociatedTokenAddress(outMint, userPk))) ? 0 : 1;
    } catch {
      return 0;
    }
  }

  /** Gasless quote (USDC to SOL only). The network cost is taken from the USDC amount, and outAmount is net of it and of the fee. */
  private async quoteGasless(userId: string, dto: JupiterSwapDto) {
    const userPk = new PublicKey(await this.usersService.getSolanaWalletAddress(userId));
    const solUsd = await fetchSolPriceUsd();
    if (!solUsd) throw new ServiceUnavailableException('Swaps are temporarily unavailable. Try again shortly.');
    const total = this.toBaseUnits(dto.amount, USDC_DECIMALS);
    const ataCount = await this.missingOutputAtaCount(userPk, new PublicKey(WSOL_MINT));
    const cost = this.costFeeUsdcUnits(ataCount, solUsd);
    if (total <= cost) throw this.costTooHigh(total, cost);
    const q = await this.v1Quote(dto, USDC_DECIMALS, SWAP_FEE_BPS, total - cost);
    // Gas is the real fee. The rest pays for the temporary SOL account, which is closed in the same
    // transaction and its deposit comes back to the user as SOL, so it is shown apart from the fee.
    const networkFee = this.costFeeUsdcUnits(0, solUsd);
    return {
      networkFeeUsdc: networkFee.toString(),
      accountDepositUsdc: (cost - networkFee).toString(),
      inAmount: String(total),
      outAmount: String(q.outAmount),
      minOutAmount: String(q.otherAmountThreshold),
      feeBps: SWAP_FEE_BPS,
      feeAmount: String(q.platformFee?.amount ?? '0'),
      networkCostUsdc: cost.toString(),
      priceImpactPct: Number(q.priceImpactPct ?? 0),
      needsAccountRent: ataCount > 0,
      inDecimals: USDC_DECIMALS,
      outDecimals: 9,
    };
  }

  /** Only USDC to native SOL is gasless: it is how someone with no SOL gets some. Every other swap pays its own network fee. */
  private isGaslessPair(dto: JupiterSwapDto): boolean {
    return dto.inputMint === USDC_MINT && dto.outputMint === WSOL_MINT;
  }

  async quoteSwap(userId: string, dto: JupiterSwapDto) {
    this.assertSwapPair(dto);
    if (this.isGaslessPair(dto) && this.gaslessEnabled()) return { ...(await this.quoteGasless(userId, dto)), gasless: true as const };
    return { ...(await this.quoteUserPays(userId, dto)), gasless: false as const };
  }

  async buildSwap(userId: string, dto: JupiterSwapDto) {
    this.assertSwapPair(dto);
    if (this.isGaslessPair(dto) && this.gaslessEnabled()) return this.buildGasless(userId, dto);
    return { ...(await this.buildUserPays(userId, dto)), gasless: false as const };
  }

  private async quoteUserPays(userId: string, dto: JupiterSwapDto) {
    const outMint = new PublicKey(dto.outputMint);
    const inDecimals = await this.decimalsOf(new PublicKey(dto.inputMint));
    const outDecimals = await this.decimalsOf(outMint);
    const q = await this.v1Quote(dto, inDecimals, MIN_FEE_BPS);

    // Estimated cost to the user in SOL: signature + typical priority fee, plus one-time account rent
    // when they do not hold the token they are buying yet (receiving native SOL needs no account).
    let needsAccountRent = false;
    if (dto.outputMint !== WSOL_MINT) {
      try {
        const wallet = new PublicKey(await this.usersService.getSolanaWalletAddress(userId));
        needsAccountRent = !(await this.connection.getAccountInfo(await getAssociatedTokenAddress(outMint, wallet)));
      } catch { /* leave false: the estimate just omits rent */ }
    }
    // The network fee is the signature plus a typical priority fee. The token-account rent is a refundable
    // deposit (closing the account returns it), so it is reported separately and not counted as a fee.
    const networkFeeLamports = 5_000 + 150_000;
    const accountDepositLamports = needsAccountRent ? TOKEN_ACCOUNT_RENT_LAMPORTS : 0;

    return {
      networkFeeLamports,
      accountDepositLamports,
      needsAccountRent,
      inAmount: String(q.inAmount),
      outAmount: String(q.outAmount),
      minOutAmount: String(q.otherAmountThreshold),
      feeBps: MIN_FEE_BPS,
      feeAmount: String(q.platformFee?.amount ?? '0'),
      priceImpactPct: Number(q.priceImpactPct ?? 0),
      inDecimals,
      outDecimals,
    };
  }

  /**
   * Builds a normal swap: the fee payer never signs it, the user is the only required signer and pays the
   * network fee in SOL. The fee payer's only involvement is opening ITS OWN token account for the output
   * mint (that is where the 0.80% lands), gated by liquidity and a daily cap.
   */
  private async buildUserPays(userId: string, dto: JupiterSwapDto) {
    const userWallet = await this.usersService.getSolanaWalletAddress(userId);
    const userPk = new PublicKey(userWallet);
    const outMint = new PublicKey(dto.outputMint);

    const outInfo = await this.connection.getAccountInfo(outMint);
    if (!outInfo || !outInfo.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new BadRequestException('That token is not supported for in-app swaps yet.');
    }
    if ((await this.connection.getBalance(userPk)) < MIN_SOL_FOR_SWAP_LAMPORTS) {
      throw new BadRequestException('You need about 0.003 SOL in your wallet for the network fee. Swap some USDC to SOL first, that one is free.');
    }

    const inDecimals = await this.decimalsOf(new PublicKey(dto.inputMint));
    const feeAccount = await this.ensureFeeTokenAccount(outMint, userId);
    const quote = await this.v1Quote(dto, inDecimals, MIN_FEE_BPS);

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

    return {
      swapTransaction: built.swapTransaction,
      lastValidBlockHeight: built.lastValidBlockHeight ?? null,
      inAmount: String(quote.inAmount),
      outAmount: String(quote.outAmount),
      minOutAmount: String(quote.otherAmountThreshold),
      feeBps: MIN_FEE_BPS,
      feeAmount: String(quote.platformFee?.amount ?? '0'),
      outDecimals: await this.decimalsOf(outMint),
    };
  }

  private async swapInstructions(quote: any, userWallet: string, feeAccount: string): Promise<any> {
    const res = await fetch(`${JUPITER_V1_BASE}/swap-instructions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.getApiKey() },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: userWallet,
        feeAccount,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: PRIORITY_FEE_CAP_LAMPORTS, priorityLevel: 'medium' } },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Could not build the swap (${res.status}): ${body.slice(0, 200)}`);
    }
    const out = await res.json();
    if (out.error) throw new BadRequestException(String(out.error).slice(0, 200));
    return out;
  }

  private toIx(j: JupIx): TransactionInstruction {
    return new TransactionInstruction({
      programId: new PublicKey(j.programId),
      keys: j.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
      data: Buffer.from(j.data, 'base64'),
    });
  }

  private rollSpendDay(): void {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.spendDay) {
      this.spendDay = day;
      this.spendLamportsToday = 0;
      this.swapsByUserDay.clear();
    }
  }

  /**
   * Builds the gasless USDC to SOL swap, which the fee payer sponsors. The fee payer is the transaction's payer and also funds the
   * output token account, and neither costs the user anything. Nothing here signs: the transaction is held
   * server-side by its hash, and only that exact message can later be co-signed (see submitSwap).
   */
  private async buildGasless(userId: string, dto: JupiterSwapDto) {
    this.assertSwapPair(dto);
    if (!this.isGaslessPair(dto)) throw new BadRequestException('Gasless swaps only convert USDC to SOL.');
    if (!this.gaslessEnabled() || !this.feePayerKeypair) throw new ServiceUnavailableException('Swaps are temporarily unavailable.');
    this.rollSpendDay();
    const feePayer = this.feePayerKeypair.publicKey;
    const userWallet = await this.usersService.getSolanaWalletAddress(userId);
    const userPk = new PublicKey(userWallet);
    const outMint = new PublicKey(dto.outputMint);

    const outInfo = await this.connection.getAccountInfo(outMint);
    if (!outInfo || !outInfo.owner.equals(TOKEN_PROGRAM_ID)) throw new BadRequestException('That token is not supported for in-app swaps yet.');
    if ((this.swapsByUserDay.get(userId) ?? 0) >= MAX_SPONSORED_SWAPS_PER_USER_PER_DAY) {
      throw new BadRequestException('You have reached today\'s swap limit. Try again tomorrow.');
    }
    if (this.spendLamportsToday >= this.dailyBudgetLamports()) throw new ServiceUnavailableException('Swaps are busy right now. Try again later.');
    if ((await this.connection.getBalance(feePayer)) < FEE_PAYER_RESERVE_LAMPORTS) throw new ServiceUnavailableException('Swaps are temporarily unavailable.');

    const inDecimals = await this.decimalsOf(new PublicKey(dto.inputMint));
    const feeAccount = await this.ensureFeeTokenAccount(outMint, userId);
    const solUsd = await fetchSolPriceUsd();
    if (!solUsd) throw new ServiceUnavailableException('Swaps are temporarily unavailable. Try again shortly.');

    // The network cost comes out of the USDC amount. Read how many token accounts the swap really opens and
    // re-quote if that raises the cost.
    const total = this.toBaseUnits(dto.amount, USDC_DECIMALS);
    let cost = this.costFeeUsdcUnits(await this.missingOutputAtaCount(userPk, outMint), solUsd);
    if (total <= cost) throw this.costTooHigh(total, cost);
    let quote = await this.v1Quote(dto, USDC_DECIMALS, SWAP_FEE_BPS, total - cost);
    let ixs = await this.swapInstructions(quote, userWallet, feeAccount);
    for (let i = 0; i < 2; i++) {
      const sponsored = (ixs.setupInstructions as JupIx[]).filter((x) => this.isOutputAtaCreate(x, userPk, outMint)).length;
      const needed = this.costFeeUsdcUnits(sponsored, solUsd, Number(ixs.prioritizationFeeLamports ?? PRIORITY_FEE_CAP_LAMPORTS));
      if (needed <= cost) break;
      cost = needed;
      if (total <= cost) throw this.costTooHigh(total, cost);
      quote = await this.v1Quote(dto, USDC_DECIMALS, SWAP_FEE_BPS, total - cost);
      ixs = await this.swapInstructions(quote, userWallet, feeAccount);
    }

    // Fund only the OUTPUT token account from the fee payer; everything else stays the user's.
    const setup = (ixs.setupInstructions as JupIx[]).map((x) =>
      this.isOutputAtaCreate(x, userPk, outMint) ? { ...x, accounts: x.accounts.map((a, idx) => (idx === 0 ? { ...a, pubkey: feePayer.toBase58() } : a)) } : x,
    );
    const sponsoredAtas = setup.filter((x) => x.accounts[0]?.pubkey === feePayer.toBase58() && x.programId === ATA_PROGRAM_ID).length;
    if (this.costFeeUsdcUnits(sponsoredAtas, solUsd, Number(ixs.prioritizationFeeLamports ?? PRIORITY_FEE_CAP_LAMPORTS)) > cost) throw new BadRequestException('Could not price this swap. Try again.');

    const all: JupIx[] = [
      ...(ixs.computeBudgetInstructions ?? []),
      ...setup,
      ixs.swapInstruction,
      ...(ixs.cleanupInstruction ? [ixs.cleanupInstruction] : []),
      ...(ixs.otherInstructions ?? []),
    ];
    this.assertSafeInstructions(all, feePayer, userPk);

    const alts: AddressLookupTableAccount[] = [];
    for (const addr of (ixs.addressLookupTableAddresses ?? []) as string[]) {
      const r = await this.connection.getAddressLookupTable(new PublicKey(addr));
      if (r.value) alts.push(r.value);
    }
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const usdcMint = new PublicKey(USDC_MINT);
    const feeUsdcAta = new PublicKey(await this.ensureFeeTokenAccount(usdcMint, userId));
    const costIx = createTransferCheckedInstruction(await getAssociatedTokenAddress(usdcMint, userPk), usdcMint, feeUsdcAta, userPk, cost, USDC_DECIMALS);
    const budgetCount = (ixs.computeBudgetInstructions ?? []).length;
    const ordered = all.map((x) => this.toIx(x));
    ordered.splice(budgetCount, 0, costIx);
    const message = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: ordered }).compileToV0Message(alts);
    const tx = new VersionedTransaction(message);

    // Never hand out a transaction that would fail: a failed landing still costs us the fee.
    const sim = await this.connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
    if (sim.value.err) {
      this.logger.warn(`[JupiterSwap] simulation failed user=${userId}: ${JSON.stringify(sim.value.err).slice(0, 160)}`);
      throw new BadRequestException('This swap would fail right now. Check your balance and try again.');
    }

    const costLamports = this.estimateCostLamports(sponsoredAtas, Number(ixs.prioritizationFeeLamports ?? PRIORITY_FEE_CAP_LAMPORTS));
    const id = randomUUID();
    this.pendingSwaps.set(id, { userId, messageHash: this.hashMessage(tx), expiresAt: Date.now() + PENDING_TTL_MS, lastValidBlockHeight, costLamports });
    this.pruneExpired();

    return {
      gasless: true as const,
      id,
      swapTransaction: Buffer.from(tx.serialize()).toString('base64'),
      inAmount: String(total),
      outAmount: String(quote.outAmount),
      minOutAmount: String(quote.otherAmountThreshold),
      feeBps: SWAP_FEE_BPS,
      feeAmount: String(quote.platformFee?.amount ?? '0'),
      networkCostUsdc: cost.toString(),
      outDecimals: await this.decimalsOf(outMint),
    };
  }

  /**
   * Co-signs and sends a swap the user signed. Only a message this server built (matched by hash, for this
   * user, within 60 seconds, once) is ever co-signed, and it is simulated once more before the fee payer pays.
   */
  async submitSwap(userId: string, dto: JupiterSwapSubmitDto) {
    if (!this.feePayerKeypair) throw new ServiceUnavailableException('Swaps are temporarily unavailable.');
    this.rollSpendDay();
    const pending = this.pendingSwaps.get(dto.id);
    this.pendingSwaps.delete(dto.id); // one shot: a signed copy can never be submitted twice
    if (!pending || pending.userId !== userId || pending.expiresAt < Date.now()) throw new BadRequestException('This swap expired. Start it again.');

    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(Buffer.from(dto.signedTransaction, 'base64'));
    } catch {
      throw new BadRequestException('Invalid transaction');
    }
    if (this.hashMessage(tx) !== pending.messageHash) {
      this.logger.error(`[JupiterSwap] message mismatch user=${userId} id=${dto.id}; refusing to co-sign`);
      throw new BadRequestException('This transaction does not match the swap we prepared.');
    }
    const userPk = new PublicKey(await this.usersService.getSolanaWalletAddress(userId));
    const userIdx = tx.message.staticAccountKeys.findIndex((k) => k.equals(userPk));
    if (userIdx < 0 || userIdx >= tx.message.header.numRequiredSignatures || !this.signatureValid(tx, userIdx, userPk)) {
      throw new BadRequestException('The swap is not signed by your wallet.');
    }

    tx.sign([this.feePayerKeypair]);
    const sim = await this.connection.simulateTransaction(tx, { sigVerify: true, commitment: 'confirmed' });
    if (sim.value.err) {
      this.logger.warn(`[JupiterSwap] pre-send simulation failed user=${userId}: ${JSON.stringify(sim.value.err).slice(0, 160)}`);
      throw new BadRequestException('The price moved and this swap would fail. Try again.');
    }

    const signature = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
    const confirmation = await this.connection.confirmTransaction(
      { signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: pending.lastValidBlockHeight },
      'confirmed',
    );
    this.spendLamportsToday += pending.costLamports;
    this.swapsByUserDay.set(userId, (this.swapsByUserDay.get(userId) ?? 0) + 1);
    this.logger.log(`SPONSORED_SWAP user=${userId} cost≈${pending.costLamports}lamports sig=${signature.slice(0, 12)}… today=${this.spendLamportsToday}`);
    if (confirmation.value.err) throw new BadRequestException('The swap did not go through. Your tokens were not moved.');
    return { signature };
  }

  private isOutputAtaCreate(x: JupIx, user: PublicKey, outMint: PublicKey): boolean {
    return x.programId === ATA_PROGRAM_ID && x.accounts.length >= 4 && x.accounts[2].pubkey === user.toBase58() && x.accounts[3].pubkey === outMint.toBase58();
  }

  /** Only known programs, no stray signers, and the fee payer touching nothing except paying and funding that one token account. */
  private assertSafeInstructions(all: JupIx[], feePayer: PublicKey, user: PublicKey): void {
    const allowed = new Set([COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID.toBase58(), ATA_PROGRAM_ID, JUPITER_V6_PROGRAM_ID]);
    const fp = feePayer.toBase58();
    const u = user.toBase58();
    for (const x of all) {
      if (!x || !allowed.has(x.programId)) throw new BadRequestException('Could not build a safe swap transaction. Try again.');
      x.accounts.forEach((a, idx) => {
        const isFundingSlot = x.programId === ATA_PROGRAM_ID && idx === 0;
        if (a.pubkey === fp && !isFundingSlot) throw new BadRequestException('Could not build a safe swap transaction. Try again.');
        if (a.isSigner && a.pubkey !== u && !(a.pubkey === fp && isFundingSlot)) throw new BadRequestException('Could not build a safe swap transaction. Try again.');
      });
    }
  }

  private hashMessage(tx: VersionedTransaction): string {
    return createHash('sha256').update(tx.message.serialize()).digest('hex');
  }

  private signatureValid(tx: VersionedTransaction, idx: number, pk: PublicKey): boolean {
    const sig = tx.signatures[idx];
    if (!sig || sig.every((b) => b === 0)) return false;
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pk.toBytes())]);
    return cryptoVerify(null, Buffer.from(tx.message.serialize()), createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(sig));
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.pendingSwaps) if (v.expiresAt < now) this.pendingSwaps.delete(k);
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
