import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { PrivateBalanceService } from '../private-balance/private-balance.service';
import { AutopaySignerService } from '../twitter-autopay/autopay-signer.service';
import { UncertainPaymentError, isUncertainBroadcastError, signatureFromError } from '../twitter-autopay/twitter-autopay.service';
import { NearIntentsService, type NearToken } from '../intents/near-intents.service';
import { isValidSolanaAddress, validateAddress, chainAliases, type WalletToken } from './wallet-flow';

/**
 * Money in and out of the person's own wallet, for the Telegram bot. Everything here is a thin layer over
 * what the app already does, so the same safety applies:
 *  - USDC to a wallet the person pasted is sent only if that wallet ALREADY has a USDC account. Creating
 *    token accounts for strangers is the path the fee payer was drained through, so it is never offered here.
 *  - Private deposits are the app's own one-time burner flow.
 *  - Cross-chain withdrawals pay into a backend-created NEAR Intents order, which the sponsor binds to.
 */
@Injectable()
export class TelegramWalletService {
  private readonly logger = new Logger(TelegramWalletService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly privateBalance: PrivateBalanceService,
    private readonly signer: AutopaySignerService,
    private readonly near: NearIntentsService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Deposit

  /**
   * A private USDC deposit on Solana: a one-time address to send to, delivered into the person's wallet
   * privately. `amountUsd` is what they want to receive; the answer says how much to send to net that.
   */
  async startPrivateDeposit(userId: string, amountUsd: number) {
    const res = await this.privateBalance.startDeposit(userId, { amount_usdc: amountUsd, cluster: 'mainnet' } as any);
    return {
      id: res.id,
      depositAddress: res.depositAddress,
      amountToSendUsdc: res.amountToSendUsdc ?? amountUsd,
      feeEstimateUsdc: res.feeEstimateUsdc ?? 0,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Withdraw USDC on Solana to a pasted wallet

  /** Everything that must be true before a pasted Solana wallet is accepted, with a plain reason when not. */
  async checkSolanaDestination(userId: string, destination: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const address = destination.trim();
    if (!isValidSolanaAddress(address)) {
      return { ok: false, reason: 'That does not look like a Solana wallet address. Paste the address again.' };
    }
    let own: string | null = null;
    try {
      own = await this.users.getSolanaWalletAddress(userId);
    } catch {
      own = null;
    }
    if (own && own === address) return { ok: false, reason: 'That is your own Loofta wallet. Paste a different address.' };
    const feePayer = this.signer.feePayerAddress;
    if (feePayer && feePayer === address) return { ok: false, reason: 'That address cannot receive withdrawals. Paste a different one.' };

    let hasAccount = false;
    try {
      hasAccount = await this.signer.usdcAccountExists(address, false);
    } catch (e) {
      this.logger.warn(`USDC account check failed: ${(e as Error).message}`);
      return { ok: false, reason: 'I could not check that wallet right now. Please try again in a moment.' };
    }
    if (!hasAccount) {
      return {
        ok: false,
        reason: 'That wallet has no USDC account yet, so it cannot receive USDC. Receive any amount of USDC there first (for example from an exchange), then try again, or pick a wallet that already holds USDC.',
      };
    }
    if (!(await this.addressIsSafe(address))) {
      return { ok: false, reason: 'That address is flagged as risky, so I will not send to it.' };
    }
    return { ok: true };
  }

  /** Range's address screening, the same one the app uses. Fails open when it is not configured or down. */
  private async addressIsSafe(address: string, network = 'solana'): Promise<boolean> {
    const key = this.config.get<string>('RANGE_API_KEY');
    if (!key) return true;
    try {
      const res = await fetch(`https://api.range.org/v1/address?address=${encodeURIComponent(address)}&network=${encodeURIComponent(network)}`, {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return true;
      const data = (await res.json()) as { malicious?: boolean };
      return data.malicious !== true;
    } catch {
      return true;
    }
  }

  /** Sends USDC from the person's wallet to the pasted wallet. Never creates the destination's account. */
  async executeSolanaWithdrawal(params: { userId: string; destination: string; amountUsd: number }): Promise<{ signature: string }> {
    if (!this.signer.isAvailable) throw new Error('Signing is not configured');
    const destination = params.destination.trim();
    if (!validateAddress(destination, 'solana')) throw new BadRequestException('Invalid destination address');
    if (!(params.amountUsd > 0)) throw new BadRequestException('Amount must be more than $0');
    const wallet = await this.signer.resolveSenderWallet(params.userId);
    if (!wallet) throw new Error('Wallet is not ready for auto-pay');
    try {
      return await this.signer.signAndSendTransfer({
        senderPrivyUserId: params.userId,
        senderWalletId: wallet.walletId,
        senderAddress: wallet.address,
        destinationAddress: destination,
        amountUsd: params.amountUsd,
        isDevnet: false,
        forbidAtaCreation: true,
      });
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (isUncertainBroadcastError(msg)) throw new UncertainPaymentError(msg, '', signatureFromError(msg));
      throw e;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Other crypto, through NEAR Intents (the "advanced" path)

  private toWalletToken(t: NearToken): WalletToken {
    return { symbol: t.symbol, chain: t.chain, tokenId: t.tokenId as string, decimals: t.decimals };
  }

  private async usdcOnSolana(): Promise<WalletToken> {
    const t = await this.near.findToken('USDC', ['solana', 'sol']);
    if (!t?.tokenId) throw new Error('USDC on Solana is not available through NEAR Intents right now');
    return this.toWalletToken(t);
  }

  /**
   * A token the person asked for. With a network it is exact; without one, a symbol that exists on several
   * networks comes back as a short list to pick from instead of a guess.
   */
  async resolveToken(symbol: string, chain?: string): Promise<{ token?: WalletToken; options?: WalletToken[] }> {
    const all = await this.near.getTokens();
    const sym = symbol.toUpperCase();
    let matches = all.filter((t) => t.symbol.toUpperCase() === sym && t.tokenId);
    if (chain) {
      const wanted = chainAliases(chain);
      matches = matches.filter((t) => wanted.includes(t.chain.toLowerCase()));
    }
    // A bridged multi-token (nep245) cannot be used with a plain deposit address; prefer the ordinary kind.
    const plain = matches.filter((t) => t.tokenId!.startsWith('nep141:'));
    if (plain.length) matches = plain;
    // USDC on Solana is the default path, not an "other crypto" option.
    matches = matches.filter((t) => !(t.symbol.toUpperCase() === 'USDC' && ['solana', 'sol'].includes(t.chain.toLowerCase())));
    const distinct = new Map<string, NearToken>();
    for (const t of matches) if (!distinct.has(t.chain.toLowerCase())) distinct.set(t.chain.toLowerCase(), t);
    const list = [...distinct.values()];
    if (list.length === 1) return { token: this.toWalletToken(list[0]) };
    if (list.length > 1) return { options: list.slice(0, 6).map((t) => this.toWalletToken(t)) };
    return {};
  }

  /** What a withdrawal would pay out, before anything is created: "you receive about Y". */
  async quoteWithdrawal(params: { userId: string; token: WalletToken; amountUsd: number; destination: string }): Promise<{ out?: number; error?: string }> {
    const usdc = await this.usdcOnSolana();
    const own = await this.users.getSolanaWalletAddress(params.userId);
    // The real destination and the person's own wallet as the refund address: placeholders are rejected for some networks.
    const q = await this.near.getDryQuote({ fromToken: usdc, toToken: params.token, amount: String(params.amountUsd), recipient: params.destination.trim(), refundTo: own });
    const out = q.amountOut != null ? Number(q.amountOut) : NaN;
    if (!(out > 0)) return { error: q.error?.message ?? 'No route for that amount right now' };
    return { out };
  }

  /** Creates the backend-tracked order the sponsor binds to (and re-quotes with the real destination). */
  async createNearWithdrawal(params: { userId: string; token: WalletToken; amountUsd: number; destination: string }) {
    if (!validateAddress(params.destination, params.token.chain)) throw new BadRequestException('Invalid destination address');
    const usdc = await this.usdcOnSolana();
    const own = await this.users.getSolanaWalletAddress(params.userId);
    const order = await this.near.createWithdrawalOrder({
      userId: params.userId,
      fromToken: { tokenId: usdc.tokenId, chain: usdc.chain, symbol: usdc.symbol, decimals: usdc.decimals },
      toToken: { tokenId: params.token.tokenId, chain: params.token.chain, symbol: params.token.symbol, decimals: params.token.decimals },
      amountUsdc: String(params.amountUsd),
      destinationAddress: params.destination.trim(),
      refundAddress: own,
      isDevnet: false,
    });
    return { ...order, out: order.amountOutFormatted != null ? Number(order.amountOutFormatted) : null };
  }

  /** Pays the USDC into the order's deposit address. The sponsor checks the address against the order. */
  async payNearOrder(params: { userId: string; order: { id: string; depositAddress: string; memo: string | null }; amountUsd: number }): Promise<{ signature: string }> {
    if (!this.signer.isAvailable) throw new Error('Signing is not configured');
    // The deposit would need a memo instruction, which the spending policy does not allow. Refuse; the app handles it.
    if (params.order.memo) throw new BadRequestException('That network needs a memo with the deposit, which I cannot add here. Please use the app for this withdrawal.');
    const wallet = await this.signer.resolveSenderWallet(params.userId);
    if (!wallet) throw new Error('Wallet is not ready for auto-pay');
    try {
      return await this.signer.signAndSendTransfer({
        senderPrivyUserId: params.userId,
        senderWalletId: wallet.walletId,
        senderAddress: wallet.address,
        destinationAddress: params.order.depositAddress,
        amountUsd: params.amountUsd,
        isDevnet: false,
        nearIntentsOrderId: params.order.id,
      });
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (isUncertainBroadcastError(msg)) throw new UncertainPaymentError(msg, params.order.id, signatureFromError(msg));
      throw e;
    }
  }

  /**
   * Adding crypto from another network: the one-time address to send to, and what arrives. The refund
   * address is the person's own address on that network, so a failed bridge refunds to them.
   */
  async quoteDeposit(params: { userId: string; token: WalletToken; amountIn: number; refundAddress: string }) {
    if (!validateAddress(params.refundAddress, params.token.chain)) throw new BadRequestException('Invalid refund address');
    const usdc = await this.usdcOnSolana();
    const own = await this.users.getSolanaWalletAddress(params.userId);
    const q = await this.near.getDepositQuote({
      fromToken: { tokenId: params.token.tokenId, chain: params.token.chain, symbol: params.token.symbol, decimals: params.token.decimals },
      toToken: { tokenId: usdc.tokenId, chain: usdc.chain, symbol: usdc.symbol, decimals: usdc.decimals },
      amountIn: String(params.amountIn),
      recipient: own,
      refundAddress: params.refundAddress.trim(),
    });
    if (!q.depositAddress) return { error: (q as any).error?.message ?? 'No route for that amount right now' } as const;
    const raw: any = q.raw;
    const outRaw = raw?.quote?.amountOutFormatted ?? raw?.amountOutFormatted;
    return {
      depositAddress: q.depositAddressDisplay ?? q.depositAddress,
      memo: q.memo ?? null,
      minAmountIn: q.minAmountInFormatted ?? null,
      deadline: q.deadline ?? null,
      out: outRaw != null ? Number(outRaw) : null,
    } as const;
  }
}
