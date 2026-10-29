import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { UsersService } from '../users/users.service';
import { isSolanaDevnetFromConfig, isSolanaLocalhostFromConfig } from '@/common/solana-cluster-env';
import { isValidSolanaAddress } from '@/common/solana-address';
import {
  MAGICBLOCK_GAS_SOL,
  MAGICBLOCK_MIN_SENDER_SOL,
  MAGICBLOCK_VOLUME_FEE_BPS,
  estimateMagicblockGrossUp,
  requestMagicblockPrivateTransfer,
  decodeActualSenderDebit,
  resolvePrivateTiming,
} from '@/common/magicblock-private-transfer';
import { BuildPrivateTokenWithdrawalDto } from './dto';
import { PRIVATE_BALANCE_PLATFORM_FEE_BPS } from './private-balance.service';

const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** Same per-withdrawal ceiling as the USDC private withdrawal, applied to the token's USD value. */
/** Native SOL goes out as wrapped SOL that MagicBlock wraps for the sender. Keep this much SOL back for the
 *  wrapped-SOL account rent (~0.00204), MagicBlock's SOL charge (0.002) and transaction fees. */
const NATIVE_SOL_OVERHEAD_SOL = 0.005;
const MIN_VALUE_USD = 1;
const MAX_VALUE_USD = 2000;
/** Backstop on rent the fee payer locks into its OWN token accounts for new mints (one account per mint, ours to close). */
const MAX_NEW_FEE_ACCOUNTS_PER_DAY = 40;

@Injectable()
export class PrivateTokenWithdrawalService {
  private readonly logger = new Logger(PrivateTokenWithdrawalService.name);
  private feeAccountCreations: number[] = [];
  private readonly feeAccountInFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly solanaSponsor: SolanaSponsorService,
  ) {}

  /**
   * Private send of any priced SPL token the user holds, straight to a Solana address.
   *
   * Why this is a separate path from the USDC withdrawal:
   *  - MagicBlock only sponsors gas for approved stablecoins ("gasless is supported only for
   *    approved stablecoin mints", verified against their API), so the SENDER pays the ~0.002 SOL
   *    network fee here and the fee payer never signs this transaction.
   *  - It deliberately writes no private_transfers row: PrivateBalanceProcessorService polls
   *    withdrawal rows and checks USDC deltas into the destination, which would misread a token row.
   *
   * Sponsor exposure: the only thing the fee payer ever pays for is the one-time creation of ITS OWN
   * token account for a mint (owner = fee payer, so we hold the key and can close it), and only for
   * mints that have a live USD price, where the caller really holds >= the amount and the amount is
   * worth $1 to $2000. It never creates an account owned by anyone else.
   */
  async build(userId: string, dto: BuildPrivateTokenWithdrawalDto) {
    if (isSolanaDevnetFromConfig(this.configService) || isSolanaLocalhostFromConfig(this.configService)) {
      throw new BadRequestException('Private token sends are available on mainnet only.');
    }
    const destination = dto.destination_address.trim();
    if (!isValidSolanaAddress(destination)) throw new BadRequestException('Invalid destination address');

    let mint: PublicKey;
    try {
      mint = new PublicKey(dto.mint.trim());
    } catch {
      throw new BadRequestException('Invalid token mint');
    }
    if (mint.toBase58() === MAINNET_USDC) {
      throw new BadRequestException('Use the standard private withdrawal for USDC.');
    }

    const conn = this.solanaSponsor.getConnectionForCluster('mainnet');
    const mintInfo = await conn.getAccountInfo(mint);
    if (!mintInfo || !mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new BadRequestException('Only standard SPL tokens are supported.');
    }
    const { decimals } = await getMint(conn, mint);
    const baseUnits = this.toBaseUnits(dto.amount, decimals);
    if (baseUnits <= 0n || baseUnits > BigInt(Number.MAX_SAFE_INTEGER)) throw new BadRequestException('Invalid amount');

    // Server-resolved sender — never a client-supplied wallet.
    const userWallet = await this.usersService.getSolanaWalletAddress(userId);
    const userPk = new PublicKey(userWallet);

    const price = await this.fetchTokenPriceUsd(mint.toBase58());
    if (price == null) throw new BadRequestException('This token has no live price yet, so it cannot be sent privately.');
    const amountHuman = Number(dto.amount);
    const valueUsd = amountHuman * price;
    if (valueUsd < MIN_VALUE_USD) throw new BadRequestException(`Private sends start at $${MIN_VALUE_USD} of value.`);
    if (valueUsd > MAX_VALUE_USD) throw new BadRequestException(`Private sends are capped at $${MAX_VALUE_USD} per transfer.`);

    const senderAta = await getAssociatedTokenAddress(mint, userPk);
    let held = 0n;
    try {
      held = (await getAccount(conn, senderAta)).amount;
    } catch { /* no token account */ }
    const feeUnitsEstimate = BigInt(estimateMagicblockGrossUp(Number(baseUnits), MAGICBLOCK_VOLUME_FEE_BPS + PRIVATE_BALANCE_PLATFORM_FEE_BPS)) - baseUnits;
    const solLamports = await conn.getBalance(userPk);
    if (mint.equals(NATIVE_MINT)) {
      // MagicBlock wraps whatever the sender lacks as wSOL, so plain SOL counts toward the amount.
      const overhead = BigInt(Math.round(NATIVE_SOL_OVERHEAD_SOL * 1e9));
      if (held + BigInt(solLamports) < baseUnits + feeUnitsEstimate + overhead) {
        throw new BadRequestException('Not enough SOL to cover the amount, the privacy fee and the network fee.');
      }
    } else {
      if (held < baseUnits + feeUnitsEstimate) {
        throw new BadRequestException('Not enough of this token to cover the amount plus the privacy fee.');
      }
      if (solLamports / 1e9 < MAGICBLOCK_MIN_SENDER_SOL) {
        throw new BadRequestException(`You need about ${MAGICBLOCK_MIN_SENDER_SOL} SOL in your wallet for the network fee of a private token send.`);
      }
    }

    const platformFeeAccount = await this.ensureFeePayerTokenAccount(mint, userId);

    let tx;
    try {
      tx = await requestMagicblockPrivateTransfer({
        from: userWallet,
        to: destination,
        mint: mint.toBase58(),
        amount: Number(baseUnits),
        cluster: 'mainnet',
        exactOut: true,
        gasless: false,
        ...(dto.split !== undefined ? { split: dto.split } : {}),
        ...resolvePrivateTiming(dto.max_delay_ms),
        platformFeeBps: PRIVATE_BALANCE_PLATFORM_FEE_BPS,
        platformFeeAccount,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[PrivateTokenWithdrawal] build failed user=${userId} mint=${mint.toBase58()}: ${msg}`);
      throw new BadRequestException(`Could not build private transfer: ${msg}`);
    }

    // decodeActualSenderDebit only sees top-level transfers (see its own note), so treat it as an
    // upper-bound hint and fall back to the bps estimate when it is missing or implausible.
    const decoded = await decodeActualSenderDebit(tx.transactionBase64, userWallet, mint, conn);
    const feeUnits =
      decoded != null && decoded > Number(baseUnits) && decoded < Number(baseUnits) * 1.05
        ? BigInt(decoded) - baseUnits
        : feeUnitsEstimate;
    const feeToken = Number(feeUnits) / 10 ** decimals;

    this.logger.log(`[PrivateTokenWithdrawal] built user=${userId} mint=${mint.toBase58().slice(0, 8)}… amount=${dto.amount} valueUsd=${valueUsd.toFixed(2)} dest=${destination.slice(0, 8)}…`);

    return {
      transactionBase64: tx.transactionBase64,
      version: tx.version,
      sendTo: tx.sendTo,
      mint: mint.toBase58(),
      decimals,
      feeAmountToken: feeToken,
      feeAmountUsd: feeToken * price,
      networkFeeSol: MAGICBLOCK_GAS_SOL,
    };
  }

  private toBaseUnits(amount: string, decimals: number): bigint {
    const [whole, frac = ''] = amount.split('.');
    if (frac.length > decimals) throw new BadRequestException(`This token supports at most ${decimals} decimal places.`);
    return BigInt(whole + frac.padEnd(decimals, '0'));
  }

  private async fetchTokenPriceUsd(mint: string): Promise<number | null> {
    const key = process.env.JUPITER_API_KEY ?? process.env.NEXT_PUBLIC_JUPITER_API_KEY;
    try {
      const res = await fetch(`https://api.jup.ag/price/v3?ids=${mint}`, {
        signal: AbortSignal.timeout(4_000),
        headers: key ? { 'x-api-key': key } : {},
      });
      const data = (await res.json()) as Record<string, { usdPrice?: number } | undefined>;
      const p = Number(data?.[mint]?.usdPrice);
      return Number.isFinite(p) && p > 0 ? p : null;
    } catch {
      return null;
    }
  }

  /**
   * MagicBlock wants Loofta's platform-fee destination to be an initialized token account, and
   * charging the fee is mandatory on mainnet. The fee payer's token account for a new mint is
   * created once, owned by the fee payer itself.
   */
  private async ensureFeePayerTokenAccount(mint: PublicKey, userId: string): Promise<string> {
    const feePayer = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayer) throw new ServiceUnavailableException('Private token sends are temporarily unavailable.');
    const conn = this.solanaSponsor.getConnectionForCluster('mainnet');
    const ata = await getAssociatedTokenAddress(mint, feePayer.publicKey);
    if (await conn.getAccountInfo(ata)) return ata.toBase58();

    const key = mint.toBase58();
    let pending = this.feeAccountInFlight.get(key);
    if (!pending) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      this.feeAccountCreations = this.feeAccountCreations.filter((t) => t > cutoff);
      if (this.feeAccountCreations.length >= MAX_NEW_FEE_ACCOUNTS_PER_DAY) {
        this.logger.warn(`[PrivateTokenWithdrawal] fee-account daily cap hit, refusing mint=${key} user=${userId}`);
        throw new ServiceUnavailableException('Private sends of new tokens are busy right now. Try again later.');
      }
      this.feeAccountCreations.push(Date.now());
      pending = (async () => {
        const tx = new Transaction().add(
          createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, ata, feePayer.publicKey, mint),
        );
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.feePayer = feePayer.publicKey;
        tx.sign(feePayer);
        const sig = await conn.sendRawTransaction(tx.serialize());
        await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        this.logger.log(`SPONSOR_FEE_ACCOUNT_CREATE user=${userId} mint=${key} owner=feePayer(self) sig=${sig.slice(0, 12)}…`);
      })().finally(() => this.feeAccountInFlight.delete(key));
      this.feeAccountInFlight.set(key, pending);
    }
    try {
      await pending;
    } catch (e) {
      this.logger.warn(`[PrivateTokenWithdrawal] fee account create failed mint=${key}: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException('Private sends of this token are unavailable right now.');
    }
    return ata.toBase58();
  }
}
