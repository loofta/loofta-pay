import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
// v1's /swap (POST, single quote+build) does not support a custom destination account — Jupiter
// returns NOT_SUPPORTED for nativeDestinationAccount/destinationTokenAccount there. v2's /order
// (GET, quote + assembled tx in one call) supports the same thing via a unified `receiver` param
// that transfers native SOL directly to an arbitrary wallet with no ATA involved.
const JUPITER_API_BASE = 'https://api.jup.ag/swap/v2';

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

  constructor(private readonly config: ConfigService) {
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
  async executeSolWithdrawal(requestId: string, signedTransactionBase64: string) {
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
}
