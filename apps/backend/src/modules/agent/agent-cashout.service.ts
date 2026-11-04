import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { generatePrivateKey } from 'viem/accounts';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { reclaimBurnerFunds } from '@/common/burner-reclaim';
import { SupabaseService } from '@/database/supabase.service';
import { isCronEnabled } from '@/common/cron-gate';
import { cashoutDepositAtomic, cashoutGrossAtomic, cashoutLooftaFeeAtomic } from '@/common/offramp-fee';
import { peerCashout, peerWithdraw, peerCashoutErrorMessage } from '@/common/peer-cashout';
import { OfframpService } from '../offramp/offramp.service';
import { RelayService } from '../lottery/relay.service';
import { RhinestoneService } from '../lottery/rhinestone.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { UsersService } from '../users/users.service';
import { SendPaymentEncryptionService } from '../send-payment/encryption.service';
import { AutopaySignerService } from '../twitter-autopay/autopay-signer.service';
import { TelegramNotifierService } from '../telegram-bot/telegram-notifier.service';
import { agentError } from './agent-error';

const SOL_USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEAD_EVM = '0x000000000000000000000000000000000000dEaD';
const DEFAULT_BASE_RPC = 'https://mainnet.base.org';

/** Platforms a handle can be paid on directly, with the handle's shape and Loofta's cap per cash-out. */
export const CASH_PLATFORMS: Record<string, { name: string; handle: RegExp; maxUsd: number | null; what: string }> = {
  revolut: { name: 'Revolut', handle: /^[A-Za-z0-9_.-]{2,40}$/, maxUsd: 1000, what: 'a Revolut username (the revtag)' },
  venmo: { name: 'Venmo', handle: /^[A-Za-z0-9_-]{4,30}$/, maxUsd: 1000, what: 'a Venmo username' },
  cashapp: { name: 'Cash App', handle: /^[A-Za-z0-9_]{1,20}$/, maxUsd: 1000, what: 'a Cash App cashtag' },
  xmoney: { name: 'X Money', handle: /^[A-Za-z0-9_]{1,15}$/, maxUsd: null, what: 'an X handle' },
};
const PLATFORM_ALIASES: Record<string, string> = { revolut: 'revolut', venmo: 'venmo', cashapp: 'cashapp', 'cash app': 'cashapp', cash_app: 'cashapp', xmoney: 'xmoney', 'x money': 'xmoney', x_money: 'xmoney', xpay: 'xmoney' };

/** A cash-out nobody fills for this long is taken back out of escrow and returned to the person's Solana wallet. */
const UNFILLED_REFUND_AFTER_MS = 6 * 60 * 60 * 1000;
/** Relay normally lands in seconds. If the USDC is not on Base after this, someone should look. */
const BRIDGE_STUCK_AFTER_MS = 45 * 60 * 1000;
const MAX_DEPOSIT_ATTEMPTS = 4;

type Step = 'funded' | 'bridging' | 'depositing' | 'creating' | 'open' | 'done' | 'refunding' | 'refunded' | 'returning' | 'failed';
const OPEN_STEPS: Step[] = ['funded', 'bridging', 'depositing', 'creating', 'open', 'refunding', 'returning'];
/** The burner gets 1% more than Relay asked for, so a quote that moves in between can never leave the bridge short. The excess goes back to the person. */
const BRIDGE_PAD = 1.01;

export interface CashPlan {
  platform: string;
  platform_name: string;
  handle: string;
  payout_usd: number;
  gross_usdc: number;
  loofta_fee_usd: number;
  bridge_fee_usd: number;
  total_from_wallet_usd: number;
}

const usd = (atomic: bigint) => Number(atomic) / 1_000_000;
const round2up = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;

/**
 * Pay a handle on Revolut / Venmo / Cash App / X Money from the person's Solana USDC. Peer Cash has to be signed
 * from a Base wallet, so each cash-out gets its own temporary Base wallet that only the backend holds (key
 * encrypted like a burner wallet): Solana -> Relay -> that wallet -> Peer deposit -> fiat to the handle. If no
 * peer fills it in time, the USDC is withdrawn and bridged home with NEAR Intents. The row in agent_cashouts is
 * written before any money moves, so a crash can always be picked up again by the cron.
 */
@Injectable()
export class AgentCashoutService implements OnModuleInit {
  private readonly logger = new Logger(AgentCashoutService.name);
  private running = false;

  constructor(
    private readonly db: SupabaseService,
    private readonly config: ConfigService,
    private readonly offramp: OfframpService,
    private readonly relay: RelayService,
    private readonly rhinestone: RhinestoneService,
    private readonly near: NearIntentsService,
    private readonly users: UsersService,
    private readonly enc: SendPaymentEncryptionService,
    private readonly signer: AutopaySignerService,
    private readonly notifier?: TelegramNotifierService,
  ) {}

  onModuleInit() {
    // The app's Cancel button on /app/pay/<id> lands here for cash-outs an agent started.
    this.offramp.registerAgentCancel({
      owns: async (offrampId) => !!(await this.db.getClient().from('agent_cashouts').select('id').eq('offramp_id', offrampId).maybeSingle()).data,
      cancel: (offrampId, userId) => this.cancelByOfframp(offrampId, userId),
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Check and price

  parse(platformIn: string, handleIn: string): { platform: string; handle: string } {
    const key = String(platformIn ?? '').trim().toLowerCase();
    const platform = PLATFORM_ALIASES[key];
    if (!platform) throw agentError('unknown_platform', `Cash-out works for ${Object.values(CASH_PLATFORMS).map((p) => p.name).join(', ')}.`);
    const handle = String(handleIn ?? '').trim().replace(/^[@$]/, '');
    if (!CASH_PLATFORMS[platform].handle.test(handle)) {
      throw agentError('bad_handle', `"${handleIn}" does not look like ${CASH_PLATFORMS[platform].what}. Ask the person for the exact handle.`);
    }
    return { platform, handle };
  }

  async plan(userId: string, platformIn: string, handleIn: string, payoutUsd: number): Promise<CashPlan> {
    const { platform, handle } = this.parse(platformIn, handleIn);
    const info = CASH_PLATFORMS[platform];
    const payout = Math.round(Number(payoutUsd) * 100) / 100;
    if (!(payout >= 1) || Math.abs(payout - Number(payoutUsd)) > 1e-9) throw agentError('bad_amount', 'Cash-outs start at $1 and are in USD with at most 2 decimals.');
    if (info.maxUsd != null && payout > info.maxUsd) throw agentError('bad_amount', `${info.name} cash-outs are at most $${info.maxUsd}.`);
    const grossAtomic = cashoutGrossAtomic(BigInt(Math.round(payout * 1_000_000)));
    const looftaFee = cashoutLooftaFeeAtomic(grossAtomic);
    const wallet = await this.users.getSolanaWalletAddress(userId).catch(() => null);
    if (!wallet) throw agentError('no_wallet', 'This account has no Solana wallet yet.', 'forbidden');
    let required: bigint;
    try {
      required = (await this.relay.getSolToBaseQuote({ fromAddress: wallet, toAddress: DEAD_EVM, outputUnits: grossAtomic - looftaFee })).requiredInputUnits;
    } catch (e) {
      this.logger.warn(`cash-out bridge quote failed: ${(e as Error).message}`);
      throw agentError('unavailable', 'The bridge to Base is not available right now. Try again in a minute.');
    }
    required = this.padded(required);
    const total = required + looftaFee;
    return {
      platform,
      platform_name: info.name,
      handle,
      payout_usd: payout,
      gross_usdc: usd(grossAtomic),
      loofta_fee_usd: round2up(usd(looftaFee)),
      bridge_fee_usd: Math.max(0, round2up(usd(required - (grossAtomic - looftaFee)))),
      total_from_wallet_usd: round2up(usd(total)),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Start (the person has approved; the agent_actions row is already 'processing')

  /** What the burner is sent for a bridge that needs `required`: a 1% cushion, returned afterwards. */
  private padded(required: bigint): bigint {
    return (required * 101n) / 100n + 2n;
  }

  private get solConn() {
    return new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
  }

  private async feePayerKeypair(): Promise<Keypair> {
    const key = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!key) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58 = await import('bs58');
    return Keypair.fromSecretKey(bs58.default.decode(key));
  }

  private solKeypair(row: any): Keypair {
    const kp = Keypair.fromSecretKey(new Uint8Array(this.enc.decrypt(row.sol_key_enc, row.sol_address)));
    if (kp.publicKey.toBase58() !== row.sol_address) throw new Error('Cash-out burner key does not match its address');
    return kp;
  }

  private async burnerUsdc(owner: PublicKey): Promise<bigint> {
    try {
      return BigInt((await this.solConn.getTokenAccountBalance(getAssociatedTokenAddressSync(SOL_USDC, owner))).value.amount);
    } catch {
      return 0n;
    }
  }

  /**
   * Creates two temporary wallets held by the backend (a Solana burner and a Rhinestone Base account with sponsored
   * gas), the history record, then moves the USDC from the person's wallet to the burner. That one plain USDC
   * transfer is the only thing signed with the person's delegated key, and the signing policy already allows it.
   * The burner bridges it with Relay (the same lane the app uses). Throws only while nothing has left the wallet;
   * after that the cron owns the rest.
   */
  async start(args: { userId: string; sessionId: string; actionId: string; platform: string; handle: string; payoutUsd: number }): Promise<{ id: string }> {
    const { platform, handle } = this.parse(args.platform, args.handle);
    const grossAtomic = cashoutGrossAtomic(BigInt(Math.round(args.payoutUsd * 1_000_000)));
    const looftaFee = cashoutLooftaFeeAtomic(grossAtomic);
    const wallet = await this.users.getSolanaWalletAddress(args.userId).catch(() => null);
    const signerWallet = await this.signer.resolveSenderWallet(args.userId);
    if (!wallet || !signerWallet || !this.signer.isAvailable) throw agentError('no_signer', 'Loofta has no permission to sign for this wallet. Turn on auto-pay in the Loofta app first.', 'forbidden');

    const basePriv = generatePrivateKey();
    const baseAddress = await this.rhinestone.getCompanionAddress(basePriv);
    const baseKeyEnc = this.enc.encrypt(Buffer.from(basePriv.slice(2), 'hex'), baseAddress);
    const burner = Keypair.generate();
    const solAddress = burner.publicKey.toBase58();
    const solKeyEnc = this.enc.encrypt(Buffer.from(burner.secretKey), solAddress);

    let sendUnits: bigint;
    try {
      const q = await this.relay.getSolToBaseQuote({ fromAddress: solAddress, toAddress: baseAddress, outputUnits: grossAtomic - looftaFee });
      sendUnits = this.padded(q.requiredInputUnits);
    } catch (e) {
      this.logger.warn(`cash-out bridge quote failed: ${(e as Error).message}`);
      throw agentError('unavailable', 'The bridge to Base is not available right now. Nothing was sent. Try again in a minute.');
    }

    const history = await this.offramp.createAgentRecord(args.userId, { platform, identifier: handle, currency: 'USD', amountUsdc: Number(grossAtomic) / 1_000_000, userSolanaAddress: wallet });
    // Written before any money moves: from here the cron can always find this and follow or return it.
    const { data: row, error } = await this.db.getClient().from('agent_cashouts').insert({
      user_id: args.userId, session_id: args.sessionId, action_id: args.actionId, offramp_id: history.id,
      platform, handle, payout_usd: args.payoutUsd, gross_usdc: Number(grossAtomic) / 1_000_000,
      base_address: baseAddress, base_key_enc: baseKeyEnc, sol_address: solAddress, sol_key_enc: solKeyEnc, step: 'funded',
    }).select('*').single();
    if (error || !row) {
      this.logger.error(`agent_cashouts insert failed: ${error?.message}`);
      await this.offramp.updateStatus(history.id, 'FAILED', 'Could not start').catch(() => undefined);
      throw agentError('failed', 'Could not start the cash-out. Nothing was sent.');
    }
    await this.setLinks(args.actionId, { share_url: `${this.appUrl}/share/${history.shortId}`, receipt_url: `${this.appUrl}/app/pay/${history.shortId}` });

    try {
      // The burner's USDC account is created and paid for by the fee payer (we hold the burner's key, so the
      // rent comes back when the burner is reclaimed). The person's transfer then needs no account creation.
      const fp = await this.feePayerKeypair();
      const burnerAta = getAssociatedTokenAddressSync(SOL_USDC, burner.publicKey);
      await sendAndConfirmTransaction(this.solConn, new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(fp.publicKey, burnerAta, burner.publicKey, SOL_USDC)), [fp], { commitment: 'confirmed' });
      await this.signer.signAndSendTransfer({
        senderPrivyUserId: args.userId,
        senderWalletId: signerWallet.walletId,
        senderAddress: signerWallet.address,
        destinationAddress: solAddress,
        amountUsd: Number(sendUnits) / 1_000_000,
        looftaFeeUsd: Number(looftaFee) / 1_000_000,
        isDevnet: false,
        forbidAtaCreation: true,
      });
    } catch (e) {
      // The transfer may have landed even though the call threw. Only fail it if the burner really got nothing.
      const got = await this.burnerUsdc(burner.publicKey).catch(() => 0n);
      if (got <= 0n) {
        const msg = (e as any)?.response?.message ?? (e as Error).message ?? 'The transfer did not go through.';
        this.logger.error(`cash-out ${row.id} funding failed: ${(e as Error).message}`);
        await this.db.getClient().from('agent_cashouts').update({ step: 'failed', error: String(msg).slice(0, 300), updated_at: new Date().toISOString() }).eq('id', row.id);
        await this.offramp.updateStatus(history.id, 'FAILED', String(msg).slice(0, 200)).catch(() => undefined);
        void this.reclaim(row);
        if (/polic|denied|not allowed|forbidden/i.test(String(msg))) throw agentError('signing_policy', 'The signing policy on this wallet blocked the transfer, so nothing was sent.', 'forbidden');
        throw agentError('failed', `${/insufficient/i.test(String(msg)) ? 'Not enough USDC in the wallet for this cash-out, including the bridge fee.' : 'The cash-out could not start.'} Nothing left your wallet.`);
      }
    }
    // Bridge straight away; if this hiccups the cron picks it up from 'funded'.
    void this.advance(row).catch((e) => this.logger.warn(`cash-out ${row.id} first bridge attempt: ${(e as Error).message}`));
    return { id: row.id };
  }

  /** The burner's leftovers (USDC above what the bridge took, token-account rent, SOL) go home. Only after the bridge is done. */
  private async settleBurner(row: any) {
    try {
      const burner = this.solKeypair(row);
      const fp = await this.feePayerKeypair();
      const extra = await this.burnerUsdc(burner.publicKey);
      if (extra > 0n) {
        const user = new PublicKey(await this.users.getSolanaWalletAddress(row.user_id));
        const userAta = getAssociatedTokenAddressSync(SOL_USDC, user);
        const burnerAta = getAssociatedTokenAddressSync(SOL_USDC, burner.publicKey);
        await sendAndConfirmTransaction(this.solConn, new Transaction().add(
          createAssociatedTokenAccountIdempotentInstruction(fp.publicKey, userAta, user, SOL_USDC),
          createTransferCheckedInstruction(burnerAta, SOL_USDC, userAta, burner.publicKey, extra, 6),
        ), [fp, burner], { commitment: 'confirmed' });
      }
      await reclaimBurnerFunds(this.solConn, burner, fp);
    } catch (e) {
      this.logger.warn(`cash-out ${row.id} settle burner: ${(e as Error).message}`);
    }
  }

  private async reclaim(row: any) {
    try {
      await reclaimBurnerFunds(this.solConn, this.solKeypair(row), await this.feePayerKeypair());
    } catch (e) {
      this.logger.warn(`cash-out ${row.id} reclaim: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Cancel (from the app's receipt page or by the agent): the same result as cancelling in the app

  async cancelByOfframp(offrampId: string, userId: string): Promise<{ status: string; message?: string }> {
    const { data: row } = await this.db.getClient().from('agent_cashouts').select('*').eq('offramp_id', offrampId).eq('user_id', userId).maybeSingle();
    if (!row) throw new BadRequestException('Cash-out not found.');
    return this.cancel(row);
  }

  async cancelByAction(userId: string, actionId: string) {
    const { data: row } = await this.db.getClient().from('agent_cashouts').select('*').eq('action_id', actionId).eq('user_id', userId).maybeSingle();
    if (!row) throw agentError('not_found', 'That is not a cash-out of yours.');
    return this.cancel(row);
  }

  private async cancel(row: any): Promise<{ status: string; message?: string }> {
    const done = { status: 'CANCELLED', message: 'Cancelled. Your USDC is on its way back to your wallet.' };
    const mark = async (from: Step, to: Step) => {
      if (!(await this.setStep(row.id, from, { step: to, error: 'Cancelled by you.' }))) throw new BadRequestException('This cash-out just moved on. Try again in a moment.');
      await this.offramp.updateStatus(row.offramp_id, 'CANCELLING').catch(() => undefined);
      return done;
    };
    switch (row.step as Step) {
      case 'refunding':
      case 'returning':
      case 'refunded':
        return done; // already on its way back
      case 'funded':
        return mark('funded', 'returning'); // the USDC is still on the burner: send it straight home
      case 'depositing':
        return mark('depositing', 'refunding'); // on Base, no order yet: bridge it home
      case 'open': {
        // Same rule as the app: once a buyer has paid, or has locked it, it cannot be cancelled.
        const rec = await this.offramp.getStatus(row.offramp_id, row.user_id);
        if (Number(rec.filled_amount_usdc ?? 0) > 0 || ['delivering', 'delivered'].includes(String(rec.fill_state ?? ''))) {
          throw new BadRequestException('A peer has already paid this payment, so it can no longer be cancelled.');
        }
        if (rec.fill_state === 'matched') throw new BadRequestException('A buyer has locked this payment but not paid yet. Try again when their lock expires.');
        return mark('open', 'refunding');
      }
      case 'bridging':
      case 'creating':
        throw new BadRequestException('The USDC is moving between networks right now. Try again in a minute or two.');
      default:
        throw new BadRequestException(`This cash-out is already ${row.step}.`);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Follow: the cron moves every open cash-out one step at a time

  @Cron(CronExpression.EVERY_MINUTE)
  async followOpen() {
    if (!isCronEnabled(this.config) || this.running) return;
    this.running = true;
    try {
      const { data } = await this.db.getClient().from('agent_cashouts').select('*').in('step', OPEN_STEPS).order('created_at', { ascending: true }).limit(20);
      for (const row of data ?? []) {
        try { await this.advance(row); } catch (e) { this.logger.warn(`cash-out ${row.id}: ${(e as Error).message}`); }
      }
    } finally {
      this.running = false;
    }
  }

  private async setStep(id: string, from: Step, patch: Record<string, unknown>): Promise<boolean> {
    const { data } = await this.db.getClient().from('agent_cashouts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('step', from).select('id');
    return !!data?.length;
  }

  async advance(row: any): Promise<void> {
    switch (row.step as Step) {
      case 'funded': return this.onFunded(row);
      case 'bridging': return this.onBridging(row);
      case 'returning': return this.onReturning(row);
      case 'depositing': return this.onDepositing(row);
      case 'open': return this.onOpen(row);
      case 'refunding': return this.onRefunding(row);
      case 'creating': {
        // Held by a running call. If the process died mid-way a deposit may exist that we never recorded, so
        // do not try again (that could deposit twice): stop and leave it for a person to check.
        if (Date.now() - new Date(row.updated_at).getTime() > 10 * 60 * 1000 && (await this.setStep(row.id, 'creating', { step: 'failed', error: 'Stopped mid-way, needs a manual check.' }))) {
          this.logger.error(`cash-out ${row.id} stuck in creating; base wallet ${row.base_address} may hold funds or a deposit`);
        }
        return;
      }
      default: return;
    }
  }

  /** The burner holds the USDC: bridge it to the Base smart account with Relay. */
  private async onFunded(row: any) {
    const gross = BigInt(Math.round(Number(row.gross_usdc) * 1_000_000));
    const burner = this.solKeypair(row);
    const have = await this.burnerUsdc(burner.publicKey);
    const quote = await this.relay.getSolToBaseQuote({ fromAddress: row.sol_address, toAddress: row.base_address, outputUnits: cashoutDepositAtomic(gross) });
    if (have < quote.requiredInputUnits) return; // the person's transfer has not shown up yet
    if (!(await this.setStep(row.id, 'funded', { step: 'bridging', relay_request_id: quote.requestId }))) return;
    try {
      const feePayer = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY')!;
      await this.relay.executeSolanaQuote({ burnerSecretKey: Buffer.from(burner.secretKey), quote, feePayerSecretKey: feePayer });
    } catch (e) {
      // Not sent (or not confirmed): go back so the next minute tries again with a fresh quote.
      this.logger.warn(`cash-out ${row.id} bridge send: ${(e as Error).message}`);
      await this.setStep(row.id, 'bridging', { step: 'funded' });
    }
  }

  private async onBridging(row: any) {
    const st = row.relay_request_id ? await this.relay.getStatus(row.relay_request_id) : 'PENDING';
    if (st === 'DONE') {
      if (await this.setStep(row.id, 'bridging', { step: 'depositing' })) void this.settleBurner(row);
      return;
    }
    if (st === 'FAILED') {
      // Relay sends a failed deposit back to the burner. Return it to the person's wallet.
      await this.setStep(row.id, 'bridging', { step: 'returning', error: 'The bridge failed.' });
      return;
    }
    if (Date.now() - new Date(row.created_at).getTime() > BRIDGE_STUCK_AFTER_MS) {
      this.logger.error(`cash-out ${row.id} bridge still pending after ${BRIDGE_STUCK_AFTER_MS / 60000} min`);
    }
  }

  /** The USDC is still on the burner (a failed bridge, or a cancel before bridging): send it to the person's own wallet. */
  private async onReturning(row: any) {
    const burner = this.solKeypair(row);
    const amount = await this.burnerUsdc(burner.publicKey);
    const cancelled = String(row.error ?? '').startsWith('Cancelled');
    if (amount <= 0n) {
      if (Date.now() - new Date(row.updated_at).getTime() > 60 * 60 * 1000 && (await this.setStep(row.id, 'returning', { step: 'failed' }))) {
        await this.finish(row, 'failed', 'The bridge failed and nothing came back to return. Check your wallet; Relay refunds failed bridges to the sending address.');
      }
      return;
    }
    const user = new PublicKey(await this.users.getSolanaWalletAddress(row.user_id));
    const userAta = getAssociatedTokenAddressSync(SOL_USDC, user);
    const fp = await this.feePayerKeypair();
    const burnerAta = getAssociatedTokenAddressSync(SOL_USDC, burner.publicKey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(fp.publicKey, userAta, user, SOL_USDC),
      createTransferCheckedInstruction(burnerAta, SOL_USDC, userAta, burner.publicKey, amount, 6),
    );
    if (!(await this.setStep(row.id, 'returning', { step: 'failed' }))) return;
    await sendAndConfirmTransaction(this.solConn, tx, [fp, burner], { commitment: 'confirmed' });
    void this.reclaim(row);
    await this.finish(row, 'failed', cancelled ? `Cancelled: ${this.label(row)} was not paid. Your USDC is back in your wallet.` : `The bridge failed, so ${this.label(row)} was not paid. Your USDC is back in your wallet.`);
  }

  private async clients(row: any) {
    const { createPublicClient, http } = await import('viem');
    const { base } = await import('viem/chains');
    const rpc = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
    const key = ('0x' + this.enc.decrypt(row.base_key_enc, row.base_address).toString('hex')) as `0x${string}`;
    const { address, walletClient } = await this.rhinestone.getSponsoredWalletClient(key);
    if (address.toLowerCase() !== String(row.base_address).toLowerCase()) throw new Error('Cash-out wallet key does not match its address');
    return {
      key,
      account: { address },
      publicClient: createPublicClient({ chain: base, transport: http(rpc) }),
      wallet: walletClient,
    };
  }

  private async usdcBalance(publicClient: any, address: string): Promise<bigint> {
    const { erc20Abi } = await import('viem');
    return (await publicClient.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] })) as bigint;
  }

  private async onDepositing(row: any) {
    if (!(await this.setStep(row.id, 'depositing', { step: 'creating' }))) return;
    const gross = BigInt(Math.round(Number(row.gross_usdc) * 1_000_000));
    const deposit = cashoutDepositAtomic(gross);
    try {
      const { account, publicClient, wallet } = await this.clients(row);
      const balance = await this.usdcBalance(publicClient, account.address);
      if (balance < deposit) { // Relay reported done before Base shows the USDC
        await this.setStep(row.id, 'creating', { step: 'depositing' });
        return;
      }
      let result: { depositId: string; txHash?: string; accessPolicyTxHash?: string };
      try {
        result = await peerCashout({ amountAtomicUsdc: deposit, grossAtomicUsdc: gross, platform: row.platform, currency: 'USD', payee: row.handle, signer: wallet });
      } catch (err) {
        const made = (err as any)?.cashout;
        if (!made?.depositId) throw err;
        result = made; // the deposit exists on-chain; only the pricing nudge failed
        this.logger.warn(`cash-out ${row.id} deposit made but not priced: ${(err as Error).message}`);
      }
      await this.offramp.recordDeposit(row.offramp_id, row.user_id, result.depositId, result.txHash ?? null, result.accessPolicyTxHash ?? null);
      await this.setStep(row.id, 'creating', { step: 'open', deposit_id: result.depositId });
      const idx = result.depositId.lastIndexOf('_');
      if (idx > 0) await this.setLinks(row.action_id, { peer_deposit_url: `https://app.peer.xyz/deposit/${result.depositId.slice(0, idx)}/${result.depositId.slice(idx + 1)}` });
      await this.progress(row, `Cash-out created. Waiting for a buyer to send the money to ${this.label(row)}.`);
    } catch (err) {
      const reason = peerCashoutErrorMessage(err) ?? (err as Error).message;
      const attempts = Number(row.attempts ?? 0) + 1;
      this.logger.warn(`cash-out ${row.id} deposit attempt ${attempts} failed: ${reason}`);
      // A handle the curator rejects will never work. Anything else gets a few more tries.
      const rejected = /not found|invalid|screen name|payee/i.test(reason);
      if (rejected || attempts >= MAX_DEPOSIT_ATTEMPTS) {
        await this.setStep(row.id, 'creating', { step: 'refunding', attempts, error: String(reason).slice(0, 300) });
      } else {
        await this.setStep(row.id, 'creating', { step: 'depositing', attempts });
      }
    }
  }

  private async onOpen(row: any) {
    const record = await this.offramp.getStatus(row.offramp_id, row.user_id).catch(() => null);
    if (!record) return;
    if (record.status === 'COMPLETE') {
      if (await this.setStep(row.id, 'open', { step: 'done' })) {
        await this.finish(row, 'paid', `Done. ${this.label(row)} was paid $${Number(row.payout_usd).toFixed(2)}.`);
      }
      return;
    }
    const filled = Number(record.filled_amount_usdc ?? 0);
    const busy = ['matched', 'delivering', 'delivered'].includes(String(record.fill_state ?? ''));
    if (!busy && filled === 0 && Date.now() - new Date(row.created_at).getTime() > UNFILLED_REFUND_AFTER_MS) {
      await this.setStep(row.id, 'open', { step: 'refunding', error: 'Nobody filled it in time.' });
    }
  }

  /** Withdraw the unfilled deposit, then bridge the USDC back to the person's Solana wallet. */
  private async onRefunding(row: any) {
    const { key, account, publicClient, wallet } = await this.clients(row);
    const gross = BigInt(Math.round(Number(row.gross_usdc) * 1_000_000));
    if (row.deposit_id) {
      let balance = await this.usdcBalance(publicClient, account.address);
      if (balance < cashoutDepositAtomic(gross) / 2n) {
        try {
              await peerWithdraw(row.deposit_id, wallet);
        } catch (e) {
          this.logger.warn(`cash-out ${row.id} withdraw: ${(e as Error).message}`); // a buyer may hold a lock; try again next minute
          return;
        }
        balance = await this.usdcBalance(publicClient, account.address);
      }
    }
    const balance = await this.usdcBalance(publicClient, account.address);
    if (balance <= 0n) return; // not back yet
    const solanaAddress = await this.users.getSolanaWalletAddress(row.user_id);
    const [baseId, solId] = await Promise.all([this.near.getDefuseAssetId('USDC', 'base'), this.near.getDefuseAssetId('USDC', 'solana')]);
    const amountIn = (Number(balance) / 1_000_000).toString();
    const quote = await this.near.getDepositQuote({
      fromToken: { tokenId: baseId, chain: 'base', symbol: 'USDC', decimals: 6 },
      toToken: { tokenId: solId, chain: 'solana', symbol: 'USDC', decimals: 6 },
      amountIn,
      recipient: solanaAddress,
      refundAddress: account.address,
    });
    if (!quote.depositAddress) throw new Error('No bridge address for the refund');
    if (!(await this.setStep(row.id, 'refunding', { step: 'refunded' }))) return;
    try {
      const { erc20Abi, encodeFunctionData } = await import('viem');
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [quote.depositAddress as `0x${string}`, balance] });
      await this.rhinestone.sendSponsored(key, [{ to: BASE_USDC, data }]);
    } catch (e) {
      // Put it back so the next minute tries again; the USDC never left the wallet if the send threw.
      await this.setStep(row.id, 'refunded', { step: 'refunding' });
      throw e;
    }
    await this.finish(row, 'failed', String(row.error ?? '').startsWith('Cancelled') ? `Cancelled: ${this.label(row)} was not paid. The USDC is on its way back to your wallet.` : `${this.label(row)} could not be paid${row.error ? ` (${row.error})` : ''}. The USDC is on its way back to your wallet.`);
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers

  private label(row: any) {
    return `${CASH_PLATFORMS[row.platform]?.name ?? row.platform} @${row.handle}`;
  }

  private get appUrl() {
    return (this.config.get<string>('NEXT_PUBLIC_APP_URL') || this.config.get<string>('NEXT_PUBLIC_BASE_URL') || 'https://pay.loofta.com').replace(/\/$/, '');
  }

  /** The receipt in the app and the public share page, plus the Peer deposit page once there is a deposit. */
  private async setLinks(actionId: string, links: Record<string, string>) {
    const { data } = await this.db.getClient().from('agent_actions').select('payload').eq('id', actionId).maybeSingle();
    if (!data) return;
    await this.db.getClient().from('agent_actions').update({ payload: { ...data.payload, links: { ...(data.payload?.links ?? {}), ...links } }, updated_at: new Date().toISOString() }).eq('id', actionId);
  }

  /** What the agent and the approval page show while it runs. */
  private async progress(row: any, text: string) {
    const { data } = await this.db.getClient().from('agent_actions').select('payload').eq('id', row.action_id).maybeSingle();
    if (!data) return;
    await this.db.getClient().from('agent_actions').update({ payload: { ...data.payload, progress: text }, updated_at: new Date().toISOString() }).eq('id', row.action_id);
  }

  /** Ends the agent's request and tells the person. */
  private async finish(row: any, outcome: 'paid' | 'failed', text: string) {
    const { data } = await this.db.getClient().from('agent_actions').select('payload').eq('id', row.action_id).maybeSingle();
    const handleKey = `${row.platform}:${row.handle}`;
    const result = outcome === 'paid' ? { handle: handleKey, status: 'sent' } : { handle: handleKey, status: 'failed', error: text };
    await this.db.getClient().from('agent_actions').update({
      status: outcome,
      error: outcome === 'failed' ? text : null,
      payload: { ...(data?.payload ?? {}), progress: text, results: [result] },
      updated_at: new Date().toISOString(),
    }).eq('id', row.action_id);
    if (outcome === 'failed' && row.offramp_id) await this.offramp.updateStatus(row.offramp_id, String(row.error ?? '').startsWith('Cancelled') ? 'CANCELLED' : 'FAILED', text.slice(0, 200)).catch(() => undefined);
    await this.notifier?.notifyUser(row.user_id, text).catch(() => undefined);
  }
}
