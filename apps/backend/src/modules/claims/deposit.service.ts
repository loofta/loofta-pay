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
    const { claimId, fromToken, amount, userAddress, refundAddress, orgReferral, isPrivate, recipientSolanaAddress } = dto;

    // Validate input
    if (!claimId || !fromToken?.tokenId || fromToken.decimals === undefined || !amount) {
      throw new BadRequestException('Missing required fields');
    }

    // Get claim details (masked for display) and raw for recipient_address (pending check)
    const claim = await this.claimsService.findOne(claimId);
    const rawClaim = await this.claimsService.findOneRaw(claimId);

    // Reject deposit if recipient has not claimed yet (created by email or username, no account / not signed up)
    const ra = rawClaim.recipient_address;
    if (ra?.startsWith(ClaimsService.PENDING_EMAIL_PREFIX)) {
      throw new BadRequestException(
        'Recipient has not claimed this payment yet. They need to open the link and sign in with their email first.'
      );
    }
    if (ra?.startsWith(ClaimsService.PENDING_USERNAME_PREFIX)) {
      throw new BadRequestException(
        'Recipient has not claimed this payment yet. They need to open the link and sign up with that username to claim it.'
      );
    }

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
      return this.handleSameChainDeposit(claim, fromToken, originChain, sameToken);
    }

    // Cross-chain: use Near Intents (pass rawClaim so we have recipient_address for quote/burner logic)
    return this.handleCrossChainDeposit(claim, rawClaim, fromToken, amount, userAddress, refundAddress, orgReferral, isPrivate, recipientSolanaAddress);
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
  ): Promise<DepositResult> {
    const originChain = String(fromToken.chain || '').toLowerCase();
    const destChain = String(claim.to_chain || '').toLowerCase();
    const useIntentsMode = false;

    try {
      const toChainLower = (claim.to_chain || '').toLowerCase();
      const isDestSolana = toChainLower === 'solana' || toChainLower === 'sol';
      const finalRecipient = (rawClaim.recipient_address || '').trim();

      // Quote recipient: private -> user embedded wallet; non-private Solana dest -> platform burner; else -> final recipient
      let recipientAddress: string;
      if (isPrivate && originChain !== 'solana' && isDestSolana && claim.to_symbol === 'USDC') {
        if (!recipientSolanaAddress) {
          throw new BadRequestException(
            'Private cross-chain payment to Solana requires login. Please connect your Loofta account and use your embedded Solana wallet address as recipient.'
          );
        }
        recipientAddress = recipientSolanaAddress;
        this.logger.log(`[Deposit] Private cross-chain: using user embedded Solana wallet as recipient: ${recipientAddress}`);
      } else if (!isPrivate && isDestSolana) {
        // Use unique claim burner (like Privacy Cash / send-payment)
        const claimBurner = (rawClaim.claim_burner_address || '').trim();
        recipientAddress = claimBurner || finalRecipient;
        if (claimBurner) this.logger.log(`[Deposit] Non-private cross-chain to Solana: using claim unique burner as quote recipient`);
        else this.logger.log(`[Deposit] Using final recipient for quote: ${recipientAddress}`);
      } else {
        recipientAddress = finalRecipient;
        this.logger.log(`[Deposit] Using recipient: ${recipientAddress}`);
      }

      if (!recipientAddress || typeof recipientAddress !== 'string') {
        throw new BadRequestException({
          message: 'Recipient address is required. For payment links to a username/email, the recipient must open the link and claim first.',
          code: 'MISSING_RECIPIENT',
        });
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
        amountOutHuman = amountUsd / destPrice; // Exact output amount in destination token
        this.logger.log(`[Deposit] Calculated amountOutHuman: ${amountOutHuman} ${claim.to_symbol} (from USD: ${amountUsd})`);
      } else {
        // Fallback: if price is not available, estimate based on 1:1 for stablecoins
        this.logger.warn(`[Deposit] Destination price not available, using fallback calculation`);
        if (claim.to_symbol.toUpperCase() === 'USDC' || claim.to_symbol.toUpperCase() === 'USDT') {
          amountOutHuman = amountUsd; // Assume 1:1 for stablecoins
        } else {
          throw new BadRequestException('Destination token price not available and cannot estimate amount');
        }
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

      // Save payment info to claim (what token/chain is being used to pay)
      await this.claimsService.updateStatus(claim.id, 'PENDING_DEPOSIT', {
        paidWithToken: fromToken.symbol,
        paidWithChain: originChain,
        isPrivate: isPrivate || false,
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
