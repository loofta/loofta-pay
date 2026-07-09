import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { SupabaseService } from '@/database/supabase.service';
import { isZkp2pDepositFulfilled, getZkp2pDepositLockState } from '../offramp/zkp2p-fulfilment.util';
import { CreateBeamDto, BEAM_PLATFORM_CAPS, BEAM_RATE } from './dto/create-beam.dto';

const DEFAULT_BASE_RPC = 'https://mainnet.base.org';

@Injectable()
export class BeamService {
  private readonly logger = new Logger(BeamService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  private getPublicClient() {
    const rpc = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
    return createPublicClient({ chain: base, transport: http(rpc) });
  }

  // dto.amountUSDC is the sender's total payment (gross, already includes the spread — the
  // frontend grosses this up from the recipient's desired receive amount before calling us,
  // so the sender absorbs the rate rather than the recipient). The platform cap is checked
  // against amountPayout (what the recipient actually receives) since that's what bounds a
  // peer's real-world payout risk, not the gross USDC amount.
  async createBeam(userId: string, dto: CreateBeamDto) {
    const amountPayout = Math.round(dto.amountUSDC * BEAM_RATE * 1e6) / 1e6;

    const cap = BEAM_PLATFORM_CAPS[dto.platform];
    if (amountPayout > cap) {
      throw new BadRequestException(`${dto.platform} payments are capped at $${cap}`);
    }

    const { data, error } = await this.supabase.getClient()
      .from('beam_payments')
      .insert({
        user_id:             userId,
        platform:            dto.platform,
        platform_identifier: dto.identifier,
        amount_usdc:         dto.amountUSDC,
        amount_payout:       amountPayout,
        currency:            dto.currency,
        base_wallet_address: dto.baseWalletAddress,
        funding_method:      'pending',
        status:              'PENDING_FUNDING',
      })
      .select('id')
      .single();

    if (error || !data) {
      this.logger.error(`createBeam failed for user ${userId}: ${JSON.stringify(error)}`);
      throw new BadRequestException('Failed to create Beam payment');
    }

    this.logger.log(`createBeam ${data.id}: user=${userId} platform=${dto.platform} amountUSDC=${dto.amountUSDC} payout=${amountPayout} currency=${dto.currency} wallet=${dto.baseWalletAddress}`);
    return { id: data.id, amountPayout, baseWalletAddress: dto.baseWalletAddress };
  }

  async confirmFunded(id: string, userId: string, fundingMethod: string, fundingReference: string | null) {
    const record = await this.getRecord(id, userId);
    if (record.status !== 'PENDING_FUNDING') {
      this.logger.warn(`confirmFunded ${id}: rejected — status is ${record.status}, expected PENDING_FUNDING`);
      throw new BadRequestException(`Cannot confirm funding from status ${record.status}`);
    }

    await this.supabase.getClient()
      .from('beam_payments')
      .update({
        funding_method:    fundingMethod,
        funding_reference: fundingReference,
        status:            'FUNDED',
        updated_at:        new Date().toISOString(),
      })
      .eq('id', id);

    this.logger.log(`confirmFunded ${id}: PENDING_FUNDING -> FUNDED via ${fundingMethod}`);
    return { status: 'FUNDED' };
  }

  // Called by frontend after it has signed the ZKP2P approve + createDeposit tx on Base.
  async recordDeposit(id: string, userId: string, depositId: string | null, txHash: string | null) {
    const record = await this.getRecord(id, userId);
    if (!['FUNDED', 'CREATING_DEPOSIT'].includes(record.status)) {
      this.logger.warn(`recordDeposit ${id}: rejected — status is ${record.status}, expected FUNDED/CREATING_DEPOSIT`);
      throw new BadRequestException(`Cannot record deposit from status ${record.status}`);
    }

    await this.supabase.getClient()
      .from('beam_payments')
      .update({
        zkp2p_deposit_id: depositId ?? null,
        zkp2p_tx_hash:    txHash ?? null,
        status:           'DEPOSITED',
        updated_at:       new Date().toISOString(),
      })
      .eq('id', id);

    this.logger.log(`recordDeposit ${id}: FUNDED -> DEPOSITED, zkp2pDepositId=${depositId} tx=${txHash}`);
    return { status: 'DEPOSITED', depositId };
  }

  // Called when a funding attempt (Coinbase/MoonPay/Blink/NEAR) was started but never
  // actually completed — the user backed out before any money moved. Only valid before a
  // ZKP2P deposit exists — once DEPOSITED, cancellation requires the on-chain flow below
  // (checkLockState → sign withdrawal → markCancelled) since USDC is now escrowed on Base.
  async cancelBeam(id: string, userId: string) {
    const record = await this.getRecord(id, userId);
    if (['COMPLETE', 'CANCELLED'].includes(record.status)) {
      this.logger.log(`cancelBeam ${id}: already ${record.status}, no-op`);
      return { status: record.status };
    }
    if (record.status === 'DEPOSITED') {
      this.logger.warn(`cancelBeam ${id}: rejected — status is DEPOSITED, needs on-chain cancel flow`);
      throw new BadRequestException('This payment has already been escrowed on-chain — use the on-chain cancel flow instead');
    }
    await this.supabase.getClient()
      .from('beam_payments')
      .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    this.logger.log(`cancelBeam ${id}: ${record.status} -> CANCELLED`);
    return { status: 'CANCELLED' };
  }

  // Reports whether a DEPOSITED payment's escrow still has USDC locked in pending intents.
  // A locked deposit cannot be safely cancelled — a peer may already be paying the recipient.
  async getLockState(id: string, userId: string) {
    const record = await this.getRecord(id, userId);
    if (record.status !== 'DEPOSITED' || !record.zkp2p_deposit_id) {
      throw new BadRequestException('This payment has no on-chain deposit to check');
    }
    const state = await getZkp2pDepositLockState(this.getPublicClient(), record.zkp2p_deposit_id);
    this.logger.log(`getLockState ${id}: deposit=${record.zkp2p_deposit_id} remaining=${state.remaining} outstanding=${state.outstanding} locked=${state.locked}`);
    return { locked: state.locked, remaining: state.remaining.toString(), outstanding: state.outstanding.toString() };
  }

  // Called by frontend after it has signed the on-chain withdrawDeposit tx (only possible
  // when getLockState reported locked: false, i.e. no peer has claimed the deposit yet).
  async markCancelled(id: string, userId: string) {
    const record = await this.getRecord(id, userId);
    if (['COMPLETE', 'CANCELLED'].includes(record.status)) {
      return { status: record.status };
    }
    await this.supabase.getClient()
      .from('beam_payments')
      .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    this.logger.log(`markCancelled ${id}: ${record.status} -> CANCELLED (on-chain withdrawal confirmed by frontend)`);
    return { status: 'CANCELLED' };
  }

  async getStatus(id: string, userId: string) {
    const record = await this.getRecord(id, userId);
    if (record.status === 'DEPOSITED' && record.zkp2p_deposit_id) {
      this.logger.log(`getStatus ${id}: DEPOSITED with deposit=${record.zkp2p_deposit_id}, re-checking fulfilment`);
      await this.checkFulfilment(record);
      return this.getRecord(id, userId);
    }
    return record;
  }

  // Excludes PENDING_FUNDING and CANCELLED — those are payments that were never actually
  // funded (abandoned before or during a funding attempt), so no money ever moved.
  async getHistory(userId: string, limit = 20) {
    const { data } = await this.supabase.getClient()
      .from('beam_payments')
      .select('id, created_at, platform, platform_identifier, amount_usdc, amount_payout, currency, status, completed_at')
      .eq('user_id', userId)
      .neq('status', 'PENDING_FUNDING')
      .neq('status', 'CANCELLED')
      .order('created_at', { ascending: false })
      .limit(limit);
    // Belt-and-suspenders: never surface an abandoned/cancelled row even if a stray one slips past the query.
    return (data ?? []).filter((r: any) => r.status !== 'PENDING_FUNDING' && r.status !== 'CANCELLED');
  }

  // Poll active DEPOSITED beams for ZKP2P fulfilment (called by cron).
  async processActiveBeams() {
    const { data: active } = await this.supabase.getClient()
      .from('beam_payments')
      .select('*')
      .eq('status', 'DEPOSITED')
      .not('zkp2p_deposit_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(20);

    if (!active?.length) return;

    this.logger.log(`processActiveBeams: checking ${active.length} DEPOSITED payment(s)`);
    for (const record of active) {
      try {
        await this.checkFulfilment(record);
      } catch (err: any) {
        this.logger.warn(`processActiveBeams error for ${record.id}: ${err.message}`);
      }
    }
  }

  private async checkFulfilment(record: any) {
    const fulfilled = await isZkp2pDepositFulfilled(this.getPublicClient(), record.zkp2p_deposit_id);
    this.logger.log(`checkFulfilment ${record.id}: deposit=${record.zkp2p_deposit_id} fulfilled=${fulfilled}`);
    if (fulfilled) {
      await this.supabase.getClient()
        .from('beam_payments')
        .update({ status: 'COMPLETE', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', record.id);
      this.logger.log(`checkFulfilment ${record.id}: DEPOSITED -> COMPLETE`);
    }
  }

  private async getRecord(id: string, userId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('beam_payments')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) throw new NotFoundException('Beam payment not found');
    return data;
  }
}
