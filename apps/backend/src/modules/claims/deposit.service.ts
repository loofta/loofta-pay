import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimsService } from './claims.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { RequestDepositDto } from './dto';

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
    const { claimId, fromToken, amount, userAddress, refundAddress, orgReferral } = dto;

    // Validate input
    if (!claimId || !fromToken?.tokenId || fromToken.decimals === undefined || !amount) {
      throw new BadRequestException('Missing required fields');
    }

    // Get claim details
    const claim = await this.claimsService.findOne(claimId);

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
      return this.handleSameChainDeposit(claim, fromToken, originChain, sameToken);
    }

    // Cross-chain: use Near Intents
    return this.handleCrossChainDeposit(claim, fromToken, amount, userAddress, refundAddress, orgReferral);
  }

  /**
   * Handle same-chain deposit scenarios
   */
  private async handleSameChainDeposit(
    claim: any,
    fromToken: RequestDepositDto['fromToken'],
    originChain: string,
    sameToken: boolean,
  ): Promise<DepositResult> {
    const isNonEvmChain = NON_EVM_CHAINS.has(originChain);

    if (sameToken) {
      // Direct transfer - no swap needed
      this.logger.log('[Deposit] Same chain + same token -> Direct transfer');

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
        depositAddress: claim.recipient_address,
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
   * Handle cross-chain deposit using Near Intents
   */
  private async handleCrossChainDeposit(
    claim: any,
    fromToken: RequestDepositDto['fromToken'],
    amount: string,
    userAddress?: string,
    refundAddress?: string,
    orgReferral?: string,
  ): Promise<DepositResult> {
    const originChain = String(fromToken.chain || '').toLowerCase();
    const useIntentsMode = INTENTS_ONLY_CHAINS.has(originChain);

    try {
      // Get destination asset ID
      const destinationAsset = await this.nearIntentsService.getDefuseAssetId(
        claim.to_symbol,
        claim.to_chain,
      );

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

      // Convert USD to token amounts
      const amountUsd = Number(claim.amount || 0);
      const originDecimals = fromToken.decimals || 18;

      // Calculate input amount with 2% buffer for slippage
      const amountInHuman = originPrice && originPrice > 0
        ? (amountUsd / originPrice) * 1.02
        : 0;

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
        amountIn: amountInHuman.toFixed(originDecimals > 8 ? 8 : originDecimals),
        recipient: claim.recipient_address,
        refundAddress: refundAddress || userAddress,
        useIntentsMode,
        referral: orgReferral || 'loofta',
      });

      if (!quoteResult.depositAddress) {
        throw new BadRequestException({
          message: 'No deposit address returned. Route may not be available.',
          code: 'NO_DEPOSIT_ADDRESS',
        });
      }

      // Create intent record
      // Note: refundAddress is stored by Near Intents, not in our database
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

      // Round up minimum amount to avoid INCOMPLETE_DEPOSIT
      let minAmountInFormatted = quoteResult.minAmountInFormatted;
      if (quoteResult.minAmountIn) {
        const amountFloat = Number(quoteResult.minAmountIn) / Math.pow(10, originDecimals);
        minAmountInFormatted = (Math.ceil(amountFloat * 1000000) / 1000000).toFixed(6);
      }

      return {
        depositAddress: quoteResult.depositAddress,
        memo: quoteResult.memo,
        deadline: quoteResult.deadline,
        timeEstimate: quoteResult.timeEstimate,
        quoteId: quoteResult.quoteId,
        minAmountIn: quoteResult.minAmountIn,
        minAmountInFormatted,
      };
    } catch (error: any) {
      this.logger.error('[Deposit] Quote error:', error?.message);

      // Check if it's a validation error we should pass through
      if (error?.response?.code) {
        throw error;
      }

      throw new BadRequestException({
        message: error?.message || 'Failed to prepare deposit',
        code: 'QUOTE_FAILED',
      });
    }
  }
}
