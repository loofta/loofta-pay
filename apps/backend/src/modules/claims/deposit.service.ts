import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimsService } from './claims.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { RequestDepositDto } from './dto';
import { fetchSolPriceUsd, MAGICBLOCK_MIN_SENDER_SOL } from '@/common/magicblock-private-transfer';

const CROSS_CHAIN_LOOFTA_FEE_BPS = 30;

// Chains that require INTENTS deposit mode
const INTENTS_ONLY_CHAINS = new Set([
  'zec', 'zcash', 'btc', 'bitcoin', 'xrp', 'xlm', 'stellar',
  'ada', 'cardano', 'ltc', 'litecoin', 'doge', 'dogecoin',
]);

// Non-EVM chains
const NON_EVM_CHAINS = new Set([
  'sol', 'solana', 'btc', 'bitcoin', 'xrp', 'xlm', 'stellar',
  'ton', 'tron', 'sui', 'ada', 'cardano', 'doge', 'dogecoin',
  'ltc', 'litecoin', 'zec', 'zcash',
]);

export interface DepositResult {
  depositAddress?: string;
  memo?: string | null;
  deadline?: string;
  timeEstimate?: number;
  quoteId?: string;
  minAmountIn?: string;
  minAmountInFormatted?: string;
  directTransfer?: boolean;
  depositToken?: string;
  depositChain?: string;
  amount?: string;
  message?: string;
  twoHop?: boolean;
  error?: string;
  code?: string;
}

/**
 * Deposit (quote/deposit address) for claim payments.
 * Routing rules: see docs/CLAIM_PAYMENT_ROUTING.md. Pending claims use burner; never reject them.
 */
@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  constructor(
    private readonly claimsService: ClaimsService,
    private readonly nearIntentsService: NearIntentsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Request deposit address for a claim payment
   */
  async requestDeposit(dto: RequestDepositDto): Promise<DepositResult> {
    const { claimId, fromToken, amount, userAddress, refundAddress, orgReferral, isPrivate, recipientSolanaAddress, waiveFees } = dto;

    // Validate input
    if (!claimId || !fromToken?.tokenId || fromToken.decimals === undefined || !amount) {
      throw new BadRequestException('Missing required fields');
    }

    // Get claim details (public/masked — the payer funding this deposit is neither the claim's
    // creator nor its recipient, same as anyone paying a public payment link, so findOne's
    // creator-or-recipient ACL would wrongly reject them) and raw for recipient_address /
    // claim_burner_address (pending claims use burner).
    const claim = await this.claimsService.findPublicSummary(claimId);
    const rawClaim = await this.claimsService.findOneRaw(claimId);

    // Enforce private payment if claim requires it
    // If claim requires private payments, the request must have isPrivate: true
    if (claim.is_private === true && !isPrivate) {
      throw new BadRequestException(
        'This payment link requires private payments only. Please use the private payment option.'
      );
    }

    const originChain = String(fromToken.chain || '').toLowerCase();
    const destChain = String(claim.to_chain || '').toLowerCase();
    const fromSymbol = String(fromToken.symbol || '').toUpperCase();
    const toSymbol = String(claim.to_symbol || '').toUpperCase();

    const sameChain = originChain === destChain;
    const sameToken = fromSymbol === toSymbol;

    this.logger.log(`[Deposit] Route analysis: ${originChain}/${fromSymbol} -> ${destChain}/${toSymbol}`);
    this.logger.log(`[Deposit] Same chain: ${sameChain}, Same token: ${sameToken}`);

    // Handle same-chain scenarios
    if (sameChain) {
      return this.handleSameChainDeposit(claim, rawClaim, fromToken, originChain, sameToken);
    }

    // Cross-chain: use Near Intents (pass rawClaim so we have recipient_address for quote/burner logic)
    return this.handleCrossChainDeposit(claim, rawClaim, fromToken, amount, userAddress, refundAddress, orgReferral, isPrivate, recipientSolanaAddress, waiveFees);
  }

  /**
   * Handle same-chain deposit scenarios.
   * Every payment now routes through the burner and requires an explicit claim — the sender
   * never pays a recipient's real wallet directly, registered or not.
   */
  private async handleSameChainDeposit(
    claim: any,
    rawClaim: { recipient_address?: string | null; claim_burner_address?: string | null },
    fromToken: RequestDepositDto['fromToken'],
    originChain: string,
    sameToken: boolean,
  ): Promise<DepositResult> {
    const isNonEvmChain = NON_EVM_CHAINS.has(originChain);

    if (sameToken) {
      // Direct transfer - no swap needed
      this.logger.log('[Deposit] Same chain + same token -> Direct transfer');

      const depositAddress = (rawClaim.claim_burner_address || '').trim();
      if (!depositAddress) {
        throw new BadRequestException({
          message: 'Burner address required for this claim.',
          code: 'MISSING_BURNER',
        });
      }

      // Calculate token amount from USD using token price
      const tokenPrice = await this.nearIntentsService.getTokenPrice(fromToken.symbol, originChain);
      const amountUsd = Number(claim.amount || 0);
      let tokenAmount = '0';

      if (Number.isFinite(amountUsd) && tokenPrice && tokenPrice > 0) {
        const rawAmount = amountUsd / tokenPrice;
        tokenAmount = (Math.ceil(rawAmount * 1000000) / 1000000).toFixed(6);
      }

      return {
        directTransfer: true,
        depositAddress: depositAddress || undefined,
        depositToken: fromToken.symbol,
        depositChain: originChain,
        amount: tokenAmount,
        minAmountInFormatted: tokenAmount,
        message: `Send ${claim.to_symbol} directly to the recipient address.`,
      };
    }

    // Same chain, different token
    if (isNonEvmChain) {
      throw new BadRequestException({
        message: `For ${originChain.toUpperCase()} payments, you must pay with ${claim.to_symbol}. Cross-token swaps are only available on EVM chains.`,
        code: 'NON_EVM_SAME_TOKEN_REQUIRED',
      });
    }

    // EVM chain with swap - would use Rhinestone
    // For now, return error asking for same token
    throw new BadRequestException({
      message: `Same-chain swaps require companion wallet setup. Please use ${claim.to_symbol} or a different chain.`,
      code: 'COMPANION_SWAP_REQUIRED',
    });
  }

  /**
   * Handle cross-chain deposit using Near Intents.
   * For cross-chain to Solana: private mode uses payer's embedded wallet; non-private uses platform burner so quote succeeds.
   */
  private async handleCrossChainDeposit(
    claim: any,
    rawClaim: { recipient_address?: string | null; claim_burner_address?: string | null },
    fromToken: RequestDepositDto['fromToken'],
    amount: string,
    userAddress?: string,
    refundAddress?: string,
    orgReferral?: string,
    isPrivate?: boolean,
    recipientSolanaAddress?: string,
    waiveFees?: boolean,
  ): Promise<DepositResult> {
    const originChain = String(fromToken.chain || '').toLowerCase();
    const destChain = String(claim.to_chain || '').toLowerCase();
    const useIntentsMode = false;

    try {
      const toChainLower = (claim.to_chain || '').toLowerCase();
      const isDestSolana = toChainLower === 'solana' || toChainLower === 'sol';
      const finalRecipient = (rawClaim.recipient_address || '').trim();
      const claimBurner = (rawClaim.claim_burner_address || '').trim();
      const isPending = finalRecipient.startsWith(ClaimsService.PENDING_EMAIL_PREFIX) || finalRecipient.startsWith(ClaimsService.PENDING_USERNAME_PREFIX);

      // Privacy: for all cross-chain payments to Solana, always deliver to the burner.
      // The backend auto-signs a private PER transfer from burner → recipient at claim time,
      // keeping the recipient's real address hidden from the NEAR intent.
      let recipientAddress: string;
      if (isDestSolana) {
        if (!claimBurner) {
          throw new BadRequestException({
            message: 'This payment link does not have a deposit address yet. Ask the recipient to open the link first.',
            code: 'MISSING_BURNER',
          });
        }
        recipientAddress = claimBurner;
        this.logger.log(`[Deposit] Cross-chain → Solana: always routing to burner for privacy (${recipientAddress.slice(0, 8)}…)`);
      } else {
        if (!finalRecipient || finalRecipient.startsWith(ClaimsService.PENDING_EMAIL_PREFIX) || finalRecipient.startsWith(ClaimsService.PENDING_USERNAME_PREFIX)) {
          throw new BadRequestException({
            message: 'Recipient address is not available yet. The recipient must open the payment link first.',
            code: 'MISSING_RECIPIENT',
          });
        }
        recipientAddress = finalRecipient;
        this.logger.log(`[Deposit] Cross-chain non-Solana dest: using finalRecipient`);
      }

      // Get destination asset ID
      const destinationAsset = await this.nearIntentsService.getDefuseAssetId(
        claim.to_symbol,
        claim.to_chain,
      );
      
      this.logger.log(`[Deposit] Destination asset ID: ${destinationAsset} for ${claim.to_symbol} on ${claim.to_chain}`);

      // Get token prices for amount calculation
      const originPrice = await this.nearIntentsService.getTokenPrice(
        fromToken.symbol,
        originChain,
      );
      const destPrice = await this.nearIntentsService.getTokenPrice(
        claim.to_symbol,
        claim.to_chain,
      );
      const destDecimals = await this.nearIntentsService.getTokenDecimals(
        claim.to_symbol,
        claim.to_chain,
      );

      this.logger.log(`[Deposit] Price info: originPrice=${originPrice}, destPrice=${destPrice}, destDecimals=${destDecimals}`);

      // Convert USD to token amounts
      const amountUsd = Number(claim.amount || 0);
      const originDecimals = fromToken.decimals || 18;

      // For EXACT_OUTPUT: calculate the exact output amount in destination token
      // For EXACT_INPUT: calculate input amount with buffer
      // We'll use EXACT_OUTPUT to ensure recipient gets exactly the requested amount
      let amountOutHuman = 0;
      let amountInHuman = 0;
      
      if (destPrice && destPrice > 0) {
        amountOutHuman = amountUsd / destPrice;
        this.logger.log(`[Deposit] Base amountOutHuman: ${amountOutHuman} ${claim.to_symbol} (USD: ${amountUsd})`);
      } else {
        this.logger.warn(`[Deposit] Destination price not available, using fallback calculation`);
        if (claim.to_symbol.toUpperCase() === 'USDC' || claim.to_symbol.toUpperCase() === 'USDT') {
          amountOutHuman = amountUsd;
        } else {
          throw new BadRequestException('Destination token price not available and cannot estimate amount');
        }
      }

      // Gross-up EXACT_OUTPUT so the burner receives requested_amount + Loofta fee (+ MagicBlock
      // gas, private claims only). At claim time the backend sweeps requested_amount to recipient
      // — via a private PER transfer for private claims, a plain public SPL transfer otherwise
      // (see ClaimsService.sweepClaimBurnerToWallet) — and the remainder is swept as dust to the
      // fee-payer wallet. A public claim's recipient is exposed regardless, so there's no privacy
      // gained by paying MagicBlock's gas for it — only cost, and a disproportionate one on small
      // payouts (SOL gas is a flat cost that doesn't scale down with the amount).
      if (isDestSolana) {
        const looftaFeeHuman = waiveFees ? 0 : amountOutHuman * CROSS_CHAIN_LOOFTA_FEE_BPS / 10_000;
        let gasFeeHuman = 0;
        if (isPrivate) {
          const solPriceUsd = await fetchSolPriceUsd();
          gasFeeHuman = solPriceUsd != null ? MAGICBLOCK_MIN_SENDER_SOL * solPriceUsd / (destPrice || 1) : 0; // in dest token units
        }
        amountOutHuman = amountOutHuman + looftaFeeHuman + gasFeeHuman;
        this.logger.log(
          `[Deposit] Fee gross-up: loofta=${looftaFeeHuman.toFixed(6)} gas=${gasFeeHuman.toFixed(6)} (isPrivate=${!!isPrivate}, waiveFees=${!!waiveFees}) → grossedAmountOut=${amountOutHuman.toFixed(6)} ${claim.to_symbol}`,
        );
      }
      
      // For EXACT_INPUT fallback (if needed), calculate input with buffer
      if (originPrice && originPrice > 0) {
        amountInHuman = (amountUsd / originPrice) * 1.02;
      } else {
        if (fromToken.symbol.toUpperCase() === 'USDC' || fromToken.symbol.toUpperCase() === 'USDT') {
          amountInHuman = amountUsd * 1.02; // Assume 1:1 for stablecoins
        }
      }

      // Get quote from Near Intents
      const quoteResult = await this.nearIntentsService.getDepositQuote({
        fromToken: {
          tokenId: fromToken.tokenId,
          chain: originChain,
          symbol: fromToken.symbol,
          decimals: originDecimals,
        },
        toToken: {
          tokenId: destinationAsset,
          chain: claim.to_chain,
          symbol: claim.to_symbol,
          decimals: destDecimals,
        },
        amountOut: amountOutHuman.toFixed(destDecimals > 8 ? 8 : destDecimals),
        useExactOutput: true, // Use EXACT_OUTPUT to ensure recipient gets exact amount
        recipient: recipientAddress, // Use Privy wallet for private cross-chain, otherwise original recipient
        refundAddress: refundAddress || userAddress,
        useIntentsMode,
        referral: orgReferral || 'loofta',
        skipAppFees: waiveFees,
      });

      if (!quoteResult.depositAddress) {
        throw new BadRequestException({
          message: 'No deposit address returned. Route may not be available.',
          code: 'NO_DEPOSIT_ADDRESS',
        });
      }

      // Create intent record
      await this.claimsService.createIntent({
        claimId: claim.id,
        quoteId: quoteResult.quoteId,
        depositAddress: quoteResult.depositAddress,
        memo: quoteResult.memo,
        deadline: quoteResult.deadline,
        timeEstimate: quoteResult.timeEstimate,
        fromChain: originChain,
        toChain: claim.to_chain,
      });

      // Save payment info to claim (what token/chain is being used to pay). expiresAt pushes the
      // claim's own expiry out to match this NEAR Intents deposit address's real validity window
      // (often ~3 days) rather than leaving it at whatever shorter default it was created with
      // (e.g. payouts' 4h) — updateStatus only ever extends, never shortens, so this is a no-op
      // for claims whose existing expiry is already later (payment links default to 7 days).
      await this.claimsService.updateStatus(claim.id, 'PENDING_DEPOSIT', {
        paidWithToken: fromToken.symbol,
        paidWithChain: originChain,
        isPrivate: isPrivate || false,
        expiresAt: quoteResult.deadline,
      });

      // Round up minimum amount to avoid INCOMPLETE_DEPOSIT
      let minAmountInFormatted = quoteResult.minAmountInFormatted;
      if (quoteResult.minAmountIn) {
        const amountFloat = Number(quoteResult.minAmountIn) / Math.pow(10, originDecimals);
        minAmountInFormatted = (Math.ceil(amountFloat * 1000000) / 1000000).toFixed(6);
      }

      return {
        // depositAddressDisplay (friendly TON format) when present — this is what the payer
        // actually sends to, never the raw form createIntent stored above for status polling.
        depositAddress: quoteResult.depositAddressDisplay || quoteResult.depositAddress,
        memo: quoteResult.memo,
        deadline: quoteResult.deadline,
        timeEstimate: quoteResult.timeEstimate,
        quoteId: quoteResult.quoteId,
        minAmountIn: quoteResult.minAmountIn,
        minAmountInFormatted,
      };
    } catch (error: any) {
      // error.message on the 1Click SDK's ApiError is usually just generic HTTP status text
      // ("Bad Request") — the actual reason ("Quoting for this pair is not available", etc.)
      // lives in error.body.message. Surface that everywhere so a failure is diagnosable from
      // this log line alone, instead of needing to reproduce the request by hand.
      const upstreamMessage = error?.body?.message || error?.response?.data?.message;
      this.logger.error(
        `[Deposit] Quote error: status=${error?.status ?? 'n/a'} message=${error?.message ?? 'n/a'} upstream=${upstreamMessage ?? 'n/a'} body=${JSON.stringify(error?.body)}`,
      );

      // Check if it's a validation error we should pass through
      if (error?.response?.code) {
        throw error;
      }

      throw new BadRequestException({
        message: upstreamMessage || error?.message || 'Failed to prepare deposit',
        code: 'QUOTE_FAILED',
      });
    }
  }
}
