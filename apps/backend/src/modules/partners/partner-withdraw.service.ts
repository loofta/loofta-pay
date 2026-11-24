import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { buildFeeLines, allocateLines, publicLines, type PublicFeeLine } from './partner-fee-lines';
import { ClaimsService } from '@/modules/claims/claims.service';
import { SolanaSponsorService } from '@/modules/claims/solana-sponsor.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { LightCompressionService } from '@/common/light-compression.service';
import { isValidSolanaAddress } from '@/common/solana-address';
import { tokenAccountExists } from '@/common/token-account-exists';
import { fetchSolPriceUsd } from '@/common/magicblock-private-transfer';
import { ATA_RENT_LAMPORTS } from '@/common/ata-rent-recovery';
import { PartnerKycService } from './partner-kyc.service';
import { PartnersService, Partner, PublicPartner } from './partners.service';
import { allocateFeeUnits, computeLooftaWithdrawFeeUsdc, computePartnerFeeUsdc, P2P_MIN_USD, P2P_RATE_PERCENT } from './partner-fee';
import { PartnerFeeSettingsService } from './partner-fee-settings.service';
import { DEMO_ORG_ID, DemoQuery, demoConfirm, demoQuote } from './partner-demo';
import { WITHDRAW_METHODS, WithdrawMethod, enabledMethods } from './partner-withdraw-options';

const MAX_PAYOUTS_PER_WITHDRAWAL = 50;
const toUnits = (usd: number) => BigInt(Math.round(usd * 1_000_000));

interface PayoutView {
  payment_id: string;
  amount: number;
  message: string | null;
  created_at: string;
  funded: boolean;
}

/** A payout the signed-in recipient already withdrew from this partner. */
export interface HistoryView {
  payment_id: string;
  amount: number;
  message: string | null;
  received_at: string;
  withdrawn_at: string;
  partner_fee_usdc: number;
}

const MAX_HISTORY = 50;

export interface WithdrawQuote {
  partner: PublicPartner;
  available: PayoutView[];
  processing: PayoutView[];
  gross_usdc: number;
  partner_fee_usdc: number;
  loofta_fee_usdc: number;
  /** One-time cost of creating the USDC account the money lands in, when it does not exist yet. Paid by the person withdrawing. 0 otherwise. */
  setup_fee_usdc: number;
  /** The same fees as above, one line per owner, so the page can show who is paid what. */
  fees: PublicFeeLine[];
  net_usdc: number;
  min_usd: number;
  p2p_min_usd: number;
  /** Percent under the market rate that P2P pays out at. Shown to the recipient before they confirm. */
  p2p_rate_percent: number;
  can_withdraw: boolean;
  reason: string | null;
  /** Set when this partner asked the person to verify their identity and they have not passed yet. */
  kyc: { status: string } | null;
  /** Routes this partner leaves on, in display order. */
  methods: WithdrawMethod[];
  /** False when the partner hides history; `history` is then always empty. */
  history_enabled: boolean;
  history: HistoryView[];
}

/**
 * The only way to withdraw money a partner paid. A recipient logs in as the identity the payout was
 * sent to, sees every fee up front, and confirms; the fee is then stamped on each payment BEFORE its
 * burner is swept (the sweep refuses an unstamped partner payout), so it cannot be skipped.
 */
@Injectable()
export class PartnerWithdrawService {
  private readonly logger = new Logger(PartnerWithdrawService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly partners: PartnersService,
    private readonly claims: ClaimsService,
    private readonly sponsor: SolanaSponsorService,
    private readonly feeSettings: PartnerFeeSettingsService,
    // Explicit token: a `Type | null` parameter is emitted as `Object`, which Nest cannot resolve, and Optional would silently give null.
    @Optional() @Inject(LightCompressionService) private readonly light: LightCompressionService | null = null,
    @Optional() private readonly kyc?: PartnerKycService,
  ) {}

  private get isDevnet() {
    return isSolanaDevnetFromConfig(this.config);
  }

  private usdcMint(): PublicKey {
    return new PublicKey(
      this.isDevnet
        ? this.config.get<string>('SOLANA_USDC_MINT_DEVNET') || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
        : this.config.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );
  }

  private async loadPartner(orgId: string): Promise<Partner> {
    const { data } = await this.supabase.partners.select('*').eq('org_id', orgId).maybeSingle();
    if (!data) throw new NotFoundException('Partner not found.');
    // A suspended partner's recipients can still withdraw: the money is theirs. Only the partner's cut is suspended.
    return this.partners.promoteFeeWalletIfDue(data as Partner);
  }

  /** The payouts this logged-in user may withdraw from this partner: identity-checked, and funded on-chain. */
  private async findPayouts(partner: Partner, userId: string): Promise<{ rows: Array<PayoutView & { units: bigint; registered: boolean; stampedAt: string | null; email: string | null }> }> {
    const { data, error } = await this.supabase.payments
      .select('id, amount, description, created_at, burner_address, recipient_user_id, is_devnet, partner_fee_stamped_at, recipient_email')
      .eq('partner_id', partner.id)
      .is('partner_withdrawn_at', null)
      .not('burner_address', 'is', null)
      .not('status', 'in', '("CANCELLED","DELETED")')
      .order('created_at', { ascending: true })
      .limit(MAX_PAYOUTS_PER_WITHDRAWAL);
    // A failed query must never look like "no payouts": a missing column once showed every recipient "nothing to withdraw".
    if (error) {
      this.logger.error(`Partner withdraw: could not load payouts for partner ${partner.id}: ${error.message}`);
      throw new ServiceUnavailableException('Withdrawals are temporarily unavailable. Please try again soon.');
    }

    const conn = this.sponsor.getConnectionForCluster(this.isDevnet ? 'devnet' : 'mainnet');
    const mint = this.usdcMint();
    // Which payouts hold a compressed balance. Read separately, and a database without the column (migration not run
    // yet, error 42703) is treated as "none", so it can never break the normal list.
    const compressedIds = new Set<string>();
    if (data?.length) {
      const { data: flagged, error: flagErr } = await this.supabase.payments.select('id, burner_compressed').in('id', data.map((p) => p.id as string));
      if (flagErr && flagErr.code !== '42703') {
        this.logger.error(`Partner withdraw: could not read compressed flags for partner ${partner.id}: ${flagErr.message}`);
        throw new ServiceUnavailableException('Withdrawals are temporarily unavailable. Please try again soon.');
      }
      for (const r of flagged ?? []) if ((r as { burner_compressed?: boolean | null }).burner_compressed === true) compressedIds.add(r.id as string);
    }
    const rows: Array<PayoutView & { units: bigint; registered: boolean; stampedAt: string | null; email: string | null }> = [];
    for (const p of data ?? []) {
      if ((p.is_devnet === true) !== this.isDevnet) continue;
      // Identity comes from the verified login, checked against who the payout was sent to.
      const { isRecipient } = await this.claims.checkIsRecipient(p.id, userId).catch(() => ({ isRecipient: false }));
      if (!isRecipient) continue;
      const units = toUnits(Number(p.amount));
      let funded = false;
      try {
        if (compressedIds.has(p.id as string)) {
          // Compressed payout: the burner holds a compressed balance, not a token account. If the indexer is down this
          // simply shows as "processing" for now; it never looks funded when it is not.
          funded = !!this.light && (await this.light.compressedBalance(this.isDevnet ? 'devnet' : 'mainnet', new PublicKey(p.burner_address as string), mint)) >= units;
        } else {
          const ata = await getAssociatedTokenAddress(mint, new PublicKey(p.burner_address as string), true);
          funded = (await getAccount(conn, ata, 'confirmed')).amount >= units;
        }
      } catch {
        funded = false;
      }
      rows.push({
        payment_id: p.id, amount: Number(p.amount), message: p.description ?? null, created_at: p.created_at, funded, units,
        registered: Boolean(p.recipient_user_id),
        stampedAt: (p as { partner_fee_stamped_at?: string | null }).partner_fee_stamped_at ?? null,
        email: (p as { recipient_email?: string | null }).recipient_email ?? null,
      });
    }
    return { rows };
  }

  private rentCache: { lamports: number; at: number } | null = null;

  /** What creating a USDC account costs us, in USD, with a small cushion for price moves, rounded up to the cent. */
  private async accountSetupFeeUsd(): Promise<number> {
    const conn = this.sponsor.getConnectionForCluster(this.isDevnet ? 'devnet' : 'mainnet');
    if (!this.rentCache || Date.now() - this.rentCache.at > 10 * 60_000) {
      const lamports = await conn.getMinimumBalanceForRentExemption(165).catch(() => ATA_RENT_LAMPORTS);
      this.rentCache = { lamports, at: Date.now() };
    }
    const price = await fetchSolPriceUsd().catch(() => null);
    const usd = price && price > 0 ? (this.rentCache.lamports / 1e9) * price * 1.15 : 0.25; // never free, even if the price feed is down
    return Math.ceil(usd * 100) / 100;
  }

  /**
   * The person pays for the account their money lands in. Loofta's fee payer creates it, so when the wallet has no USDC account
   * yet this is its cost, shown before they confirm. Zero when the account exists, or when we do not know the wallet yet.
   */
  private async setupFee(target: string | null): Promise<number> {
    if (!target || !isValidSolanaAddress(target)) return 0;
    const conn = this.sponsor.getConnectionForCluster(this.isDevnet ? 'devnet' : 'mainnet');
    const ata = await getAssociatedTokenAddress(this.usdcMint(), new PublicKey(target), true);
    if (await tokenAccountExists(conn, ata)) return 0;
    return this.accountSetupFeeUsd();
  }

  private async compute(partner: Partner, userId: string, method?: string, route: { destination?: string | null; ownWallet?: boolean } = {}) {
    const { rows } = await this.findPayouts(partner, userId);
    const available = rows.filter((r) => r.funded);
    const processing = rows.filter((r) => !r.funded);
    const grossUnits = available.reduce((a, r) => a + r.units, BigInt(0));
    const gross = Number(grossUnits) / 1e6;

    const partnerActive = partner.status === 'active';
    // Payouts left over from a withdrawal that partly failed carry that withdrawal's stamp time. If a sibling with the
    // same stamp already went through, the flat fee was taken then and is not taken again.
    const stamps = [...new Set(available.map((r) => r.stampedAt).filter((t): t is string => !!t))];
    let flatAlreadyPaid = false;
    if (stamps.length) {
      const { data: done, error } = await this.supabase.payments
        .select('id').eq('partner_id', partner.id).in('partner_fee_stamped_at', stamps).not('partner_withdrawn_at', 'is', null).limit(1);
      if (error) throw new ServiceUnavailableException('Withdrawals are temporarily unavailable. Please try again soon.');
      flatAlreadyPaid = !!done?.length;
    }
    const partnerFee = partnerActive ? computePartnerFeeUsdc(partner, gross, { flatAlreadyPaid }) : 0;
    // Loofta's fee is the same on every route: a flat part and a percentage, always shown to the recipient first.
    const looftaFee = computeLooftaWithdrawFeeUsdc(gross, { flatAlreadyPaid, ...(await this.feeSettings.get()) });
    // Where the money will land: the wallet they typed, or (for the other routes) their own Loofta wallet.
    const target = route.destination ?? (route.ownWallet ? await this.claims.recipientWalletFor(userId) : null);
    const setupFee = grossUnits > BigInt(0) ? await this.setupFee(target).catch(() => 0) : 0;
    const net = gross - partnerFee - looftaFee - setupFee;
    let feeLines: PublicFeeLine[] = [];
    try {
      feeLines = publicLines(
        buildFeeLines({ grossUnits, partnerFeeUnits: toUnits(partnerFee), partnerWallet: partner.fee_wallet ?? null, looftaFeeUnits: toUnits(looftaFee) }).lines,
      );
    } catch {
      // Fees that cannot be built (too small, no wallet) already turn into a plain reason below.
    }
    if (setupFee > 0) feeLines.push({ kind: 'setup', label: 'New wallet account (one time)', usdc: setupFee });

    // A person the partner asked to verify cannot withdraw until they pass. Checked first so they see what to do, not a fee message.
    const kycBlock = available.length ? await this.kyc?.blockingFor(partner as unknown as { id: string; org_id: string; name: string; kyc_enabled?: boolean }, rows.map((r) => r.email ?? '')) ?? null : null;
    let reason: string | null = null;
    if (kycBlock) reason = kycBlock.status === 'failed' ? 'Your identity check did not pass. Ask the company that paid you to review it.' : 'Verify your identity to withdraw.';
    else if (!available.length) reason = processing.length ? 'Your payout is still being processed.' : 'Nothing to withdraw yet.';
    else if (gross < Number(partner.withdraw_min_usd)) reason = `The minimum withdrawal is $${Number(partner.withdraw_min_usd).toFixed(2)}.`;
    else if (method === 'p2p' && gross < P2P_MIN_USD) reason = `P2P cash-outs start at $${P2P_MIN_USD.toFixed(2)}.`;
    else if (net <= 0) reason = 'This amount is too small to withdraw after fees.';
    else if (partnerFee > 0) {
      if (!partner.fee_wallet) reason = 'Withdrawals from this partner are unavailable right now.';
      else {
        try {
          await this.partners.assertFeeWalletReady(partner.fee_wallet);
        } catch {
          reason = 'Withdrawals from this partner are unavailable right now.';
        }
      }
    }

    const strip = ({ units: _u, registered: _r, stampedAt: _s, email: _e, ...v }: PayoutView & { units: bigint; registered: boolean; stampedAt: string | null; email: string | null }): PayoutView => v;
    return {
      available, processing: processing.map(strip), partnerFee, looftaFee, setupFee, gross, net, reason, feeLines, kyc: kycBlock,
      view: available.map(strip),
    };
  }

  /**
   * Payouts this user already withdrew from this partner. Ownership is recipient_user_id, which the claim stamps with the
   * verified login, so another user's payouts can never appear. Database only, no chain reads, capped.
   */
  private async findHistory(partner: Partner, userId: string): Promise<HistoryView[]> {
    const { data, error } = await this.supabase.payments
      .select('id, amount, description, created_at, paid_at, partner_withdrawn_at, partner_fee_usdc')
      .eq('partner_id', partner.id)
      .eq('recipient_user_id', userId)
      .not('partner_withdrawn_at', 'is', null)
      .order('partner_withdrawn_at', { ascending: false })
      .limit(MAX_HISTORY);
    if (error) {
      this.logger.error(`Partner withdraw: could not load history for partner ${partner.id}: ${error.message}`);
      throw new ServiceUnavailableException('Withdrawals are temporarily unavailable. Please try again soon.');
    }
    // The title is the partner's own note for the payout, else the name of the batch it was paid in.
    // Labels are only ever read for this partner's batches. A lookup failure just falls back to no title.
    const labelOf = new Map<string, string>();
    const ids = (data ?? []).map((r) => r.id as string);
    if (ids.length) {
      const { data: items } = await this.supabase.payoutBatchItems.select('payment_id, batch_id').in('payment_id', ids);
      const batchIds = [...new Set((items ?? []).map((i) => i.batch_id as string))];
      if (batchIds.length) {
        const { data: batches } = await this.supabase.payoutBatches.select('id, label').eq('partner_id', partner.id).in('id', batchIds);
        const names = new Map((batches ?? []).filter((b) => b.label).map((b) => [b.id as string, b.label as string]));
        for (const i of items ?? []) {
          const name = names.get(i.batch_id as string);
          if (name) labelOf.set(i.payment_id as string, name);
        }
      }
    }
    return (data ?? []).map((r) => ({
      payment_id: r.id as string,
      amount: Number(r.amount) || 0,
      message: (r.description as string | null) || labelOf.get(r.id as string) || null,
      // When the partner sent it (funded), not when the person withdrew it. Falls back to when it was created.
      received_at: ((r.paid_at as string | null) || (r.created_at as string)) as string,
      withdrawn_at: r.partner_withdrawn_at as string,
      partner_fee_usdc: Number(r.partner_fee_usdc) || 0,
    }));
  }

  private async kycEmails(partner: Partner, userId: string): Promise<string[]> {
    const { rows } = await this.findPayouts(partner, userId);
    return rows.map((r) => r.email ?? '').filter(Boolean);
  }

  /** Starts the identity check for the signed-in recipient. Only works for an address they were proven to own. */
  async kycStart(orgId: string, userId: string) {
    if (!this.kyc || orgId === DEMO_ORG_ID) throw new BadRequestException('No identity check is waiting for you.');
    const partner = await this.loadPartner(orgId);
    return this.kyc.startForRecipient(partner as never, await this.kycEmails(partner, userId));
  }

  /** The recipient finished the check: ask zkMe and update. */
  async kycCheck(orgId: string, userId: string) {
    if (!this.kyc || orgId === DEMO_ORG_ID) throw new BadRequestException('No identity check is waiting for you.');
    const partner = await this.loadPartner(orgId);
    return this.kyc.checkForRecipient(partner as never, await this.kycEmails(partner, userId));
  }

  async quote(orgId: string, userId: string, demo?: DemoQuery, route: { method?: string; destination?: string } = {}): Promise<WithdrawQuote> {
    if (orgId === DEMO_ORG_ID) return demoQuote(demo, await this.feeSettings.get());
    const partner = await this.loadPartner(orgId);
    // Once the person has picked a route (and, for USDC, typed a wallet) the quote includes the cost of a new account there.
    const method = route.method && WITHDRAW_METHODS.includes(route.method as WithdrawMethod) ? route.method : undefined;
    const destination = method === 'usdc' && route.destination && isValidSolanaAddress(route.destination.trim()) ? route.destination.trim() : undefined;
    const c = await this.compute(partner, userId, method, { destination, ownWallet: !!method && method !== 'usdc' });
    const { data: pub } = await this.supabase.partners
      .select('org_id, name, logo_url, brand_color, withdraw_min_usd, fee_fixed_usd, fee_percent_bps').eq('id', partner.id).single();
    const historyEnabled = (partner as { show_history?: boolean }).show_history !== false;
    const disabled = (partner as { disabled_withdraw_methods?: string[] }).disabled_withdraw_methods ?? [];
    return {
      partner: { ...(pub as object), disabled_withdraw_methods: disabled, show_history: historyEnabled } as unknown as PublicPartner,
      methods: enabledMethods(disabled),
      history_enabled: historyEnabled,
      history: historyEnabled ? await this.findHistory(partner, userId) : [],
      available: c.view,
      processing: c.processing,
      gross_usdc: c.gross,
      partner_fee_usdc: c.partnerFee,
      loofta_fee_usdc: c.looftaFee,
      setup_fee_usdc: c.setupFee,
      fees: c.feeLines,
      net_usdc: Math.max(c.net, 0),
      min_usd: Number(partner.withdraw_min_usd),
      p2p_min_usd: P2P_MIN_USD,
      p2p_rate_percent: P2P_RATE_PERCENT,
      can_withdraw: c.reason === null,
      reason: c.reason,
      kyc: c.kyc,
    };
  }

  /**
   * Withdraws everything currently available. `maxFeeUsdc` is the partner fee the recipient was
   * shown; if the real fee is higher (the partner changed it in between) nothing is stamped or sent.
   */
  async confirm(orgId: string, userId: string, opts: { maxFeeUsdc: number; maxLooftaFeeUsdc?: number; destinationAddress?: string; method?: string }) {
    if (opts.method !== undefined && !WITHDRAW_METHODS.includes(opts.method as WithdrawMethod)) throw new BadRequestException('Unknown withdraw method.');
    if (orgId === DEMO_ORG_ID) {
      if (!Number.isFinite(opts.maxFeeUsdc) || opts.maxFeeUsdc < 0) throw new BadRequestException('max_fee_usdc is required.');
      if (opts.destinationAddress && !isValidSolanaAddress(opts.destinationAddress.trim())) throw new BadRequestException('Invalid destination address.');
      return demoConfirm();
    }
    const dest = opts.destinationAddress?.trim();
    if (dest && !isValidSolanaAddress(dest)) throw new BadRequestException('Invalid destination address.');
    if (!Number.isFinite(opts.maxFeeUsdc) || opts.maxFeeUsdc < 0) throw new BadRequestException('max_fee_usdc is required.');

    const partner = await this.loadPartner(orgId);
    // Sending to an external wallet is the USDC route; claiming into the recipient's own wallet serves the other three.
    const on = enabledMethods((partner as { disabled_withdraw_methods?: string[] }).disabled_withdraw_methods);
    const wanted: WithdrawMethod[] = opts.method ? [opts.method as WithdrawMethod] : dest ? ['usdc'] : ['token', 'bank', 'p2p'];
    if (dest && opts.method && opts.method !== 'usdc') throw new BadRequestException('A destination wallet only applies to USDC withdrawals.');
    if (!wanted.some((m) => on.includes(m))) throw new ForbiddenException('This way of withdrawing is switched off by this partner.');
    const c = await this.compute(partner, userId, opts.method, { destination: dest, ownWallet: !dest });
    if (c.reason) throw new BadRequestException(c.reason);
    if (c.partnerFee > opts.maxFeeUsdc + 1e-9) {
      throw new ConflictException('The fee changed since you last looked. Review it and confirm again.');
    }
    // The page also sends the Loofta fee it showed. If Loofta changed its rate in between, nothing is charged blind.
    if (opts.maxLooftaFeeUsdc !== undefined && c.looftaFee + c.setupFee > opts.maxLooftaFeeUsdc + 1e-9) {
      throw new ConflictException('The fee changed since you last looked. Review it and confirm again.');
    }

    // One stamp time for the whole withdrawal, so a retry can tell which payouts belonged to it.
    const stampedAt = new Date().toISOString();
    const shares = allocateFeeUnits(c.available.map((r) => r.units), toUnits(c.partnerFee));
    // Everything that stays with Loofta's fee payer: its own fee plus the cost of creating the person's account.
    const looftaShares = allocateFeeUnits(c.available.map((r) => r.units), toUnits(c.looftaFee) + toUnits(c.setupFee));
    const wallet = c.partnerFee > 0 ? partner.fee_wallet : null;
    const results: Array<{ payment_id: string; ok: boolean; tx?: string; error?: string }> = [];

    for (let i = 0; i < c.available.length; i++) {
      const p = c.available[i];
      try {
        // Stamp the fee BEFORE sweeping; conditional so a payout already withdrawn can never be re-stamped.
        const { data: stamped } = await this.supabase.payments
          .update({
            partner_fee_usdc: Number(shares[i]) / 1e6,
            partner_loofta_fee_usdc: Number(looftaShares[i]) / 1e6,
            partner_fee_wallet: shares[i] > BigInt(0) ? wallet : null,
            partner_fee_stamped_at: stampedAt,
          })
          .eq('id', p.payment_id)
          .eq('partner_id', partner.id)
          .is('partner_withdrawn_at', null)
          .select('id');
        if (!stamped?.length) throw new Error('This payout is no longer available.');

        const out = await this.claims.claimAsRecipient(p.payment_id, userId, { viaPartnerWithdraw: true, destinationAddress: dest });
        if (!out.sweepTxHash) throw new Error('Funds have not arrived yet. Try again in a minute.');
        results.push({ payment_id: p.payment_id, ok: true, tx: out.sweepTxHash });
        await this.recordFeeLines(partner.id, p, shares[i], looftaShares[i], wallet, stampedAt);
      } catch (e) {
        this.logger.warn(`partner withdraw ${p.payment_id}: ${(e as Error).message}`);
        results.push({ payment_id: p.payment_id, ok: false, error: (e as Error).message });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    await this.partners.audit(partner.id, userId, 'recipient.withdrew', undefined, {
      payouts: results.length, sent, partner_fee_usdc: c.partnerFee, to: dest ?? 'own_wallet',
    });
    return { results, partner_fee_usdc: c.partnerFee };
  }
  /**
   * Writes the fee lines of one swept payout to the ledger, so the partner's fee and Loofta's fee are recorded apart.
   * Best effort on purpose: the money has already moved and the payment row already carries the partner fee, so a missing
   * table or a failed insert must never fail the withdrawal. The unique index makes a retry harmless.
   */
  private async recordFeeLines(partnerId: string, p: { payment_id: string; units: bigint }, partnerShare: bigint, looftaUnits: bigint, partnerWallet: string | null, stampedAt: string) {
    try {
      const lines = allocateLines([p.units], buildFeeLines({ grossUnits: p.units, partnerFeeUnits: partnerShare, partnerWallet, looftaFeeUnits: looftaUnits }).lines)[0];
      if (!lines.length) return;
      await this.supabase.partnerPaymentFeeLines.upsert(
        lines.map((l) => ({ payment_id: p.payment_id, partner_id: partnerId, kind: l.kind, units: l.units.toString(), destination: l.destination, status: 'collected', stamped_at: stampedAt })),
        { onConflict: 'payment_id,kind', ignoreDuplicates: true },
      );
    } catch (e) {
      this.logger.warn(`fee lines for ${p.payment_id} not recorded: ${(e as Error).message}`);
    }
  }
}
