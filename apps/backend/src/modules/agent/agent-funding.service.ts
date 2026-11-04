import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '@/database/supabase.service';
import { isCronEnabled } from '@/common/cron-gate';
import { NearIntentsService, type NearToken } from '../intents/near-intents.service';
import { UsersService } from '../users/users.service';
import { TelegramNotifierService } from '../telegram-bot/telegram-notifier.service';
import { JupiterService } from '../jupiter/jupiter.service';
import { AutopaySignerService } from '../twitter-autopay/autopay-signer.service';
import { fetchSolPriceUsd } from '@/common/magicblock-private-transfer';
import { TelegramWalletService } from '../telegram-bot/telegram-wallet.service';
import { escapeHtml } from '../telegram-bot/telegram-api';
import { validateAddress, chainAliases } from '../telegram-bot/wallet-flow';
import { agentError } from './agent-payments.service';
import type { AgentSession } from './agent-auth.service';

export type FundingStatus = 'awaiting_deposit' | 'processing' | 'incomplete' | 'received' | 'refunded' | 'failed' | 'expired';
const OPEN: FundingStatus[] = ['awaiting_deposit', 'processing', 'incomplete'];
const MAX_OPEN_PER_SESSION = 10;
const POLL_WINDOW_MS = 36 * 60 * 60 * 1000;
/** A quote's deadline is when the swap must be done by; the deposit itself may land a little later. */
const EXPIRY_GRACE_MS = 15 * 60 * 1000;

const EVM_CHAINS = ['eth', 'ethereum', 'base', 'arb', 'arbitrum', 'op', 'optimism', 'pol', 'polygon', 'matic', 'bsc', 'bnb', 'avax', 'avalanche', 'gnosis', 'bera', 'berachain', 'linea', 'scroll', 'blast'];
const isEvm = (chain: string) => EVM_CHAINS.includes(chain.toLowerCase());
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** What a SOL deposit should cover beyond the USDC wanted: Loofta's 0.80% swap fee, slippage room and the network fee. */
const SOL_SWAP_BUFFER = 1.02;
const SOL_NETWORK_RESERVE = 0.004;
const isSolana = (chain: string) => ['sol', 'solana'].includes(chain.toLowerCase());

/** NEAR Intents (1Click) status -> what we tell the person. */
export function mapNearStatus(raw: unknown): FundingStatus | null {
  switch (String(raw ?? '').toUpperCase()) {
    case 'PENDING_DEPOSIT': return 'awaiting_deposit';
    case 'KNOWN_DEPOSIT_TX':
    case 'PROCESSING': return 'processing';
    case 'INCOMPLETE_DEPOSIT': return 'incomplete';
    case 'SUCCESS': return 'received';
    case 'REFUNDED': return 'refunded';
    case 'FAILED': return 'failed';
    default: return null;
  }
}

export interface FundRequest {
  token: string;
  chain?: string;
  /** How much of the token to send. Give this or receive_usdc. */
  amount?: number;
  /** How many USDC should arrive. Give this or amount. */
  receive_usdc?: number;
  /** Where a failed swap is returned: a wallet of the person's own, on the chain they send from. */
  refund_address?: string;
  /** Hide the link between the deposit and the payout (NEAR Confidential Intents). Default true. */
  confidential?: boolean;
  /** Allow an ordinary public swap when confidential is not available for this token. Default false. */
  allow_public?: boolean;
  /** A Solana token's mint address, for tokens other than SOL. */
  mint?: string;
}

/**
 * Pay with any token. The person sends a token from any supported chain to a one-time address; NEAR
 * Intents (confidentially when it can) turns it into USDC in their own Loofta wallet. We follow the order
 * and say so when it arrives, or when it is refunded, so the agent (and the person) never have to guess.
 */
@Injectable()
export class AgentFundingService {
  private readonly logger = new Logger(AgentFundingService.name);
  private polling = false;

  constructor(
    private readonly db: SupabaseService,
    private readonly config: ConfigService,
    private readonly near: NearIntentsService,
    private readonly users: UsersService,
    private readonly notifier: TelegramNotifierService,
    private readonly tgWallet?: TelegramWalletService,
    private readonly jupiter?: JupiterService,
    private readonly signer?: AutopaySignerService,
  ) {}

  private get appUrl() {
    return this.config.get<string>('APP_URL') || this.config.get<string>('NEXT_PUBLIC_BASE_URL') || 'https://pay.loofta.com';
  }

  // ---------------------------------------------------------------------------------------------
  // Create

  private async usdcOnSolana(): Promise<NearToken> {
    const t = await this.near.findToken('USDC', ['solana', 'sol']);
    if (!t?.tokenId) throw agentError('unavailable', 'USDC on Solana is not available through NEAR Intents right now. Try again in a moment.');
    return t;
  }

  private async resolveToken(symbol: string, chain?: string): Promise<NearToken> {
    const all = await this.near.getTokens();
    const sym = symbol.trim().toUpperCase();
    let matches = all.filter((t) => t.symbol.toUpperCase() === sym && t.tokenId);
    if (chain) {
      const wanted = chainAliases(chain);
      matches = matches.filter((t) => wanted.includes(t.chain.toLowerCase()));
    }
    // A bridged multi-token (nep245) cannot be paid to a plain deposit address.
    const plain = matches.filter((t) => t.tokenId!.startsWith('nep141:'));
    if (plain.length) matches = plain;
    const byChain = new Map<string, NearToken>();
    for (const t of matches) if (!byChain.has(t.chain.toLowerCase())) byChain.set(t.chain.toLowerCase(), t);
    const list = [...byChain.values()];
    if (!list.length) throw agentError('unknown_token', `I could not find ${symbol}${chain ? ` on ${chain}` : ''} in NEAR Intents.`);
    if (list.length > 1) {
      throw agentError('chain_required', `${symbol.toUpperCase()} exists on several networks (${list.slice(0, 8).map((t) => t.chain).join(', ')}). Say which one.`);
    }
    return list[0];
  }

  /** The refund address must be the person's own: a swap that fails pays it back there. */
  private async assertRefundIsTheirs(userId: string, chain: string, address: string) {
    if (!validateAddress(address, chain)) throw agentError('bad_refund_address', `That is not a valid ${chain} address.`);
    let ok = false;
    if (isSolana(chain)) {
      ok = (await this.users.getSolanaWalletAddress(userId).catch(() => null)) === address.trim();
    } else if (isEvm(chain)) {
      ok = await this.users.isEvmAddressInLinkedAccounts(userId, address.trim()).catch(() => false);
    } else {
      throw agentError('unsupported_chain', `Funding from ${chain} is not available here yet. Use Solana or an EVM network (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche).`);
    }
    if (!ok) {
      throw agentError('refund_address_not_yours', 'The refund address has to be a wallet linked to your Loofta account, so a failed swap can only ever return to you. Link it in Loofta, or use your Loofta wallet address.');
    }
  }

  /**
   * Every way to add money, in one answer: no questions first. The wallet address takes USDC on Solana
   * directly; a private deposit or another token gets a one-time address; card lives on the app page.
   */
  async options(session: AgentSession, req: { amount_usd?: number; private?: boolean } = {}) {
    if (!session.scopes.includes('pay')) throw agentError('missing_scope', "This session was not granted 'pay'.", 'forbidden');
    const wallet = await this.users.getSolanaWalletAddress(session.userId).catch(() => null);
    if (!wallet) throw agentError('no_wallet', 'This account has no Solana wallet yet.', 'forbidden');
    const out: Record<string, unknown> = {
      send_usdc_on_solana_to: wallet,
      instructions: 'Send USDC on Solana to wallet_address. It arrives in about a minute and is a normal public transfer.',
      card_link: `${this.appUrl}/app?deposit=1`,
      other_ways: [
        'Card, Apple Pay or Google Pay: open card_link.',
        'Another token (SOL, ETH, USDT, BONK, ...) on Solana or an EVM network: call fund_with_token with the token and chain and either how much to send or receive_usdc. SOL is fine. It is swapped to USDC in this wallet and the quote shows the exact amount to send with fees included.',
        'Private deposit (the deposit is not linked to the wallet): call fund_wallet with private true and amount_usd (1 to 2000).',
      ],
      paying_privately: 'Payments out can be private too: set privately true on pay or quote_payment. It costs a little extra and arrives after a short delay.',
    };
    if (req.private) {
      const amount = Number(req.amount_usd);
      if (!(amount >= 1 && amount <= 2000)) throw agentError('bad_amount', 'A private deposit is 1 to 2000 USD. Give amount_usd.');
      if (!this.tgWallet) throw agentError('unavailable', 'Private deposits are not available right now.');
      const d = await this.tgWallet.startPrivateDeposit(session.userId, Math.round(amount * 100) / 100);
      out.private_deposit = {
        send_exactly_usdc: d.amountToSendUsdc,
        network: 'solana',
        to_one_time_address: d.depositAddress,
        you_receive_usd: amount,
        fee_estimate_usdc: d.feeEstimateUsdc,
        note: 'Use this address once, only for USDC on Solana. It reaches the wallet privately within a few minutes.',
      };
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Solana tokens: swapped inside the wallet with Jupiter (cross-chain still goes through NEAR Intents)

  /** SOL by name, any other token by its mint address. A bare symbol is never trusted: scam tokens copy them. */
  private solanaMint(token: string): string | null {
    const t = token.trim();
    if (t.toUpperCase() === 'SOL') return WSOL_MINT;
    return MINT_RE.test(t) ? t : null;
  }

  /** How much to send, with fees, for a SOL top-up. Nothing is created: the person sends to their own wallet. */
  private async solanaTokenPlan(session: AgentSession, req: FundRequest, wallet: string, mint: string) {
    const out: Record<string, unknown> = {
      route: 'jupiter',
      send_to: wallet,
      network: 'solana',
      instructions: '',
    };
    if (mint === WSOL_MINT) {
      let send: number | null = null;
      if (req.amount != null) send = Number(req.amount);
      else if (req.receive_usdc != null) {
        const px = await fetchSolPriceUsd();
        if (px) send = Math.ceil(((Number(req.receive_usdc) / px) * SOL_SWAP_BUFFER + SOL_NETWORK_RESERVE) * 1e4) / 1e4;
      }
      if (send) out.send_amount = send;
      out.token = 'SOL';
      out.instructions = `Send ${send ? `${send} SOL` : 'the SOL'} on Solana to send_to (your Loofta wallet). That covers the swap fee (0.80%), price movement and the network fee, which is paid in SOL. When it arrives, call swap_to_usdc with token SOL and the amount to turn it into USDC.`;
    } else {
      out.token = req.token;
      out.mint = mint;
      out.instructions = `Send the token on Solana to send_to (your Loofta wallet). The swap needs about 0.004 SOL in the wallet for the network fee. When it arrives, call swap_to_usdc with this mint and the amount.`;
    }
    return { ...out, id: undefined, status: 'awaiting_deposit', swap_fee: '0.80%', next: out.instructions };
  }

  /** Swaps a token the wallet already holds into USDC, signed with the person's delegated key. */
  async swapToUsdc(session: AgentSession, req: { token: string; amount: number | string }) {
    if (!session.scopes.includes('pay')) throw agentError('missing_scope', "This session was not granted 'pay'.", 'forbidden');
    const mint = this.solanaMint(String(req.token ?? ''));
    if (!mint) throw agentError('unknown_token', 'Use SOL, or the token mint address. A name alone is not safe to swap.');
    if (mint === USDC_MINT) throw agentError('bad_token', 'That is already USDC.');
    if (!this.jupiter || !this.signer?.isAvailable) throw agentError('unavailable', 'Swaps are not available right now.');
    const amount = String(req.amount ?? '').trim();
    if (!/^\d{1,18}(\.\d{1,18})?$/.test(amount) || Number(amount) <= 0) throw agentError('bad_amount', 'Give the amount of the token to swap, as a plain number.');
    const wallet = await this.signer.resolveSenderWallet(session.userId);
    if (!wallet) throw agentError('no_signer', 'Loofta has no permission to sign for this wallet. Turn on auto-pay in the Loofta app first.', 'forbidden');
    const dto = { inputMint: mint, outputMint: USDC_MINT, amount, slippageBps: 100 };
    let quote: any;
    try {
      quote = await this.jupiter.quoteSwap(session.userId, dto as any);
    } catch (e) {
      throw agentError('no_route', (e as any)?.response?.message ?? (e as Error).message ?? 'No route for that swap right now.');
    }
    const usdc = Number(quote.outAmount) / 1e6;
    if (usdc > session.dailyCapUsd) throw agentError('over_session_limit', `That swap is worth about $${usdc.toFixed(2)}, more than this session's $${session.dailyCapUsd} daily limit. Swap less, or raise the limit in the Loofta app.`, 'forbidden');
    let built: any;
    try {
      built = await this.jupiter.buildSwap(session.userId, dto as any);
    } catch (e) {
      throw agentError('swap_failed', (e as any)?.response?.message ?? (e as Error).message ?? 'Could not build the swap.');
    }
    if (built.gasless || !built.swapTransaction) throw agentError('swap_failed', 'Could not build the swap. Try again.');
    try {
      const { signature } = await this.signer.signAndSendOwnWalletTransaction({ walletId: wallet.walletId, walletAddress: wallet.address, transactionBase64: built.swapTransaction, lastValidBlockHeight: built.lastValidBlockHeight });
      return { status: 'swapped', token: String(req.token), swapped: amount, received_usdc_about: Number((Number(built.outAmount) / 1e6).toFixed(2)), min_received_usdc: Number((Number(built.minOutAmount) / 1e6).toFixed(2)), fee: '0.80%', signature, next: 'The USDC is in the Loofta wallet. You can pay now.' };
    } catch (e) {
      this.logger.warn(`agent swap failed user=${session.userId}: ${(e as Error).message}`);
      throw agentError('swap_failed', (e as any)?.response?.message ?? 'The swap did not go through. Your tokens were not moved.');
    }
  }

  async fund(session: AgentSession, req: FundRequest) {
    if (!session.scopes.includes('pay')) throw agentError('missing_scope', "This session was not granted 'pay'.", 'forbidden');
    const hasIn = req.amount != null;
    const hasOut = req.receive_usdc != null;
    if (hasIn === hasOut) throw agentError('bad_amount', 'Give exactly one of amount (how much of the token to send) or receive_usdc (how many USDC should arrive).');
    const amount = Number(hasIn ? req.amount : req.receive_usdc);
    if (!Number.isFinite(amount) || amount <= 0) throw agentError('bad_amount', 'The amount must be more than 0.');
    if (hasOut && amount < 1) throw agentError('bad_amount', 'Funding starts at 1 USDC.');

    const { data: openRows } = await this.db.getClient().from('agent_funding_orders').select('id').eq('session_id', session.id).in('status', OPEN);
    if ((openRows?.length ?? 0) >= MAX_OPEN_PER_SESSION) throw agentError('too_many_open', 'You already have several fundings waiting. Finish or let them expire first.');

    // Solana tokens are swapped inside the wallet with Jupiter (SOL by name, anything else by mint).
    // Only cross-chain funding goes through NEAR Intents.
    const solMint = !req.chain || isSolana(req.chain) ? (this.solanaMint(req.token) ?? (req.mint && MINT_RE.test(req.mint) ? req.mint : null)) : null;
    if (solMint && solMint !== USDC_MINT) {
      const w = await this.users.getSolanaWalletAddress(session.userId).catch(() => null);
      if (!w) throw agentError('no_wallet', 'This account has no Solana wallet yet.', 'forbidden');
      return this.solanaTokenPlan(session, req, w, solMint);
    }
    const from = await this.resolveToken(req.token, req.chain);
    const to = await this.usdcOnSolana();
    const wallet = await this.users.getSolanaWalletAddress(session.userId).catch(() => null);
    if (!wallet) throw agentError('no_wallet', 'This account has no Solana wallet yet.', 'forbidden');
    // USDC on Solana needs no swap: it goes straight to the wallet.
    if (from.symbol.toUpperCase() === 'USDC' && isSolana(from.chain)) return this.options(session);
    // Any other Solana token is a Jupiter swap in the wallet, by mint: a bare symbol is not safe to trust.
    if (isSolana(from.chain)) throw agentError('mint_required', `Give the ${from.symbol} mint address (the token contract) so I swap the right one.`);
    // From Solana the only valid refund address is the person's own Loofta wallet, so there is nothing to ask.
    const refundAddress = (req.refund_address ?? '').trim() || (isSolana(from.chain) ? wallet : '');
    if (!refundAddress) throw agentError('refund_address_required', `Ask the person for their own ${from.chain} wallet address. A failed swap is refunded there.`);
    await this.assertRefundIsTheirs(session.userId, from.chain, refundAddress);

    const wantConfidential = req.confidential !== false;
    const levels: Array<'advanced' | 'basic' | undefined> = wantConfidential ? ['advanced', 'basic'] : [undefined];
    if (wantConfidential && req.allow_public) levels.push(undefined);

    let quote: Awaited<ReturnType<NearIntentsService['getDepositQuote']>> | null = null;
    let used: 'advanced' | 'basic' | undefined;
    let lastError = '';
    for (const level of levels) {
      try {
        const q = await this.near.getDepositQuote({
          fromToken: { tokenId: from.tokenId!, chain: from.chain, symbol: from.symbol, decimals: from.decimals },
          toToken: { tokenId: to.tokenId!, chain: to.chain, symbol: to.symbol, decimals: to.decimals },
          ...(hasIn ? { amountIn: String(amount) } : { amountOut: String(amount), useExactOutput: true }),
          recipient: wallet,
          refundAddress,
          confidentiality: level,
          deadlineMs: 60 * 60 * 1000,
        });
        if (q?.depositAddress) { quote = q; used = level; break; }
        lastError = q?.error?.message ?? 'No route for that amount right now.';
      } catch (e) {
        lastError = (e as any)?.body?.message ?? (e as Error).message ?? 'No route for that amount right now.';
      }
    }
    if (!quote?.depositAddress) {
      if (wantConfidential && !req.allow_public) {
        throw agentError('confidential_unavailable', `A confidential swap is not available for ${from.symbol} on ${from.chain} right now (${lastError}). Ask the person if a public swap is fine, then retry with allow_public true.`);
      }
      throw agentError('no_route', lastError || 'No route for that amount right now.');
    }

    const raw: any = quote.raw;
    const sendAmount = hasIn ? String(amount) : (quote.amountInFormatted ?? raw?.quote?.amountInFormatted ?? null);
    const expectedOut = hasOut ? amount : Number(quote.amountOutFormatted ?? raw?.quote?.amountOutFormatted ?? NaN);
    const depositAddress = quote.depositAddress;
    const { data: row, error } = await this.db.getClient().from('agent_funding_orders').insert({
      user_id: session.userId,
      session_id: session.id,
      from_symbol: from.symbol,
      from_chain: from.chain,
      from_token_id: from.tokenId,
      amount_in: sendAmount,
      expected_usdc: Number.isFinite(expectedOut) ? expectedOut : null,
      deposit_address: depositAddress,
      memo: quote.memo ?? null,
      deadline: quote.deadline ?? null,
      confidentiality: used ?? 'public',
      refund_address: refundAddress,
      recipient_address: wallet,
      status: 'awaiting_deposit',
      created_at: new Date().toISOString(),
    }).select('*').single();
    if (error || !row) {
      this.logger.error(`funding insert failed: ${error?.message}`);
      throw agentError('failed', 'Could not record this funding. Nothing was sent. Try again.');
    }
    return { ...this.view(row), send_to: quote.depositAddressDisplay ?? depositAddress, next: this.nextStep(row) };
  }

  // ---------------------------------------------------------------------------------------------
  // Follow

  /** Reads the order's live state from NEAR Intents and saves any change. Says so once when it ends. */
  async refresh(row: any): Promise<any> {
    if (!OPEN.includes(row.status)) return row;
    let status: FundingStatus | null = null;
    let details: any = null;
    let nearStatus: string | null = row.near_status;
    try {
      const res = await this.near.getExecutionStatus(row.deposit_address);
      nearStatus = String(res?.status ?? res?.state ?? '').toUpperCase() || row.near_status;
      status = mapNearStatus(nearStatus);
      details = res?.swapDetails ?? null;
    } catch (e) {
      // 1Click answers 404 until it has seen the deposit; that is "still waiting", not a failure.
      this.logger.debug(`status check for funding ${row.id}: ${(e as Error).message}`);
    }
    if (!status) status = row.status;
    // Nothing arrived and the quote is long past: it can no longer complete.
    if (status === 'awaiting_deposit' && row.deadline && Date.now() > new Date(row.deadline).getTime() + EXPIRY_GRACE_MS) status = 'expired';

    const patch: Record<string, unknown> = { last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (nearStatus && nearStatus !== row.near_status) patch.near_status = nearStatus;
    if (status !== row.status) patch.status = status;
    if (status === 'received') {
      const out = Number(details?.amountOutFormatted ?? row.expected_usdc);
      if (Number.isFinite(out)) patch.received_usdc = out;
      patch.tx_hash = details?.destinationChainTxHashes?.[0]?.hash ?? row.tx_hash ?? null;
    }
    if (status === 'refunded') {
      patch.refunded_amount = details?.refundedAmountFormatted ?? null;
      patch.tx_hash = details?.refundTxHashes?.[0]?.hash ?? details?.originChainTxHashes?.[0]?.hash ?? row.tx_hash ?? null;
    }
    const { data: updated } = await this.db.getClient().from('agent_funding_orders').update(patch).eq('id', row.id).select('*').maybeSingle();
    const next = updated ?? { ...row, ...patch };
    if (!OPEN.includes(next.status as FundingStatus)) await this.tellThePerson(next);
    return next;
  }

  /** One message per order, whichever of the cron and the agent's own check sees the ending first. */
  private async tellThePerson(row: any) {
    const { data: claimed } = await this.db.getClient().from('agent_funding_orders').update({ notified_at: new Date().toISOString() }).eq('id', row.id).is('notified_at', null).select('id');
    if (!claimed?.length) return;
    const text = this.message(row);
    if (text) await this.notifier.notifyUser(row.user_id, text);
  }

  message(row: any): string | null {
    const token = `${escapeHtml(row.from_symbol)} on ${escapeHtml(row.from_chain)}`;
    switch (row.status as FundingStatus) {
      case 'received':
        return `Your deposit arrived. <b>${row.received_usdc ?? row.expected_usdc ?? ''} USDC</b> from ${token} is now in your Loofta wallet.`;
      case 'refunded':
        return `Your ${token} deposit could not be swapped and was <b>refunded</b> to <code>${escapeHtml(row.refund_address)}</code>${row.refunded_amount ? ` (${escapeHtml(String(row.refunded_amount))})` : ''}.`;
      case 'failed':
        return `Your ${token} deposit failed. If you sent funds, they are returned to <code>${escapeHtml(row.refund_address)}</code>. Check the order again in a few minutes.`;
      case 'expired':
        return `The ${token} deposit address expired before anything arrived. Nothing was spent. Ask for a new one if you still want to fund.`;
      default:
        return null;
    }
  }

  private nextStep(row: any): string {
    switch (row.status as FundingStatus) {
      case 'awaiting_deposit': return `Send ${row.amount_in ?? 'the amount'} ${row.from_symbol} on ${row.from_chain} to the address above${row.memo ? ` with memo ${row.memo}` : ''}. Send only that token on that network. Check funding_status for the result.`;
      case 'processing': return 'The deposit was seen and is being swapped. Check again in a minute.';
      case 'incomplete': return 'Less than the minimum arrived. It will be refunded if it is not topped up before the deadline.';
      case 'received': return 'Done. The USDC is in the Loofta wallet. You can pay now.';
      case 'refunded': return 'The swap did not complete and the funds were refunded to the refund address.';
      case 'failed': return 'The swap failed. Any funds sent are returned to the refund address.';
      default: return 'This address expired. Ask for a new one.';
    }
  }

  view(row: any) {
    return {
      id: row.id,
      status: row.status as FundingStatus,
      token: row.from_symbol,
      chain: row.from_chain,
      deposit_address: row.deposit_address,
      memo: row.memo ?? undefined,
      send_amount: row.amount_in ?? undefined,
      expected_usdc: row.expected_usdc != null ? Number(row.expected_usdc) : undefined,
      received_usdc: row.received_usdc != null ? Number(row.received_usdc) : undefined,
      confidential: row.confidentiality !== 'public',
      confidentiality: row.confidentiality,
      refund_address: row.refund_address,
      deadline: row.deadline ?? undefined,
      tx_hash: row.tx_hash ?? undefined,
    };
  }

  async status(session: AgentSession, id: string) {
    if (!session.scopes.includes('read')) throw agentError('missing_scope', "This session was not granted 'read'.", 'forbidden');
    const { data } = await this.db.getClient().from('agent_funding_orders').select('*').eq('id', id).eq('session_id', session.id).maybeSingle();
    if (!data) throw new NotFoundException('Funding not found.');
    const row = await this.refresh(data);
    return { ...this.view(row), next: this.nextStep(row) };
  }

  async list(session: AgentSession, limit = 10) {
    if (!session.scopes.includes('read')) throw agentError('missing_scope', "This session was not granted 'read'.", 'forbidden');
    const { data } = await this.db.getClient().from('agent_funding_orders').select('*').eq('session_id', session.id).order('created_at', { ascending: false }).limit(Math.min(30, Math.max(1, limit)));
    return (data ?? []).map((r: any) => this.view(r));
  }

  // ---------------------------------------------------------------------------------------------
  // Background: keep following, so the person hears about it even when the agent is not asking

  @Cron(CronExpression.EVERY_MINUTE)
  async followOpenOrders() {
    if (!isCronEnabled(this.config) || this.polling) return;
    this.polling = true;
    try {
      const since = new Date(Date.now() - POLL_WINDOW_MS).toISOString();
      const { data } = await this.db.getClient().from('agent_funding_orders').select('*').in('status', OPEN).gte('created_at', since).order('created_at', { ascending: true }).limit(40);
      for (const row of data ?? []) {
        try { await this.refresh(row); } catch (e) { this.logger.warn(`follow ${row.id}: ${(e as Error).message}`); }
      }
    } finally {
      this.polling = false;
    }
  }
}
