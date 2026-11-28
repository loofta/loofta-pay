import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { AmpleService } from './ample.service';
import { AmpleCompanionService } from './ample-companion.service';

/** Payments totalling this much (USD), made on or after the offer start, earn a pack. */
const MIN_PAYMENT_USD = 10;
const PACK_OFFER_START = '2026-11-24T00:00:00.000Z';

/**
 * Ample packs (https://api.ample.money/v1, "Ample packs"). A user earns one pack per confirmed payment; `reference` (our payment
 * id) is Ample's idempotency key, so asking again returns the same pack. Packs live on the EVM side (the user's Earn account on
 * Base, partner user id `evm:<privy id>`), because the bonus only counts if new money is deposited there before the deadline.
 *
 * Opening needs the `packs` scope. The pack id is always checked against what Ample itself issues to this user, never trusted
 * from the request.
 */
@Injectable()
export class AmplePackService {
  private readonly logger = new Logger(AmplePackService.name);

  constructor(
    private readonly ample: AmpleService,
    private readonly companion: AmpleCompanionService,
    private readonly supabase: SupabaseService,
  ) {}

  private key(userId: string) { return `evm:${userId}`; }
  private read(userId: string) { return { kind: 'session' as const, userId: this.key(userId), scopes: ['read'] }; }
  private packs(userId: string) { return { kind: 'session' as const, userId: this.key(userId), scopes: ['read', 'packs'] }; }

  /**
   * Payments made since the offer started add up toward $10. The payment that takes the running total to $10 is the pack's
   * reference (stable once reached, so Ample returns the same pack every time). Earlier payments never count.
   */
  private async paymentState(userId: string): Promise<{ id: string | null; totalUsd: number }> {
    // Some send flows only fill `created_by` (sender_user_id stays empty), so match either. `created_by` only counts for money the
    // person sent (direction from_sender), never a request they created. IN_FLIGHT and PRIVATE_TRANSFER_PENDING are private sends whose
    // sender leg is already paid, and they never get a paid_at.
    const uid = userId.replace(/[^A-Za-z0-9:_-]/g, '');
    const { data } = await this.supabase.getClient().from('payments').select('id, status, amount, created_at')
      .or(`sender_user_id.eq.${uid},and(created_by.eq.${uid},direction.eq.from_sender)`)
      .eq('is_devnet', false).in('status', ['SUCCESS', 'PRIVATE_TRANSFER_PENDING', 'IN_FLIGHT'])
      .gte('created_at', PACK_OFFER_START).order('created_at', { ascending: true }).limit(500);
    let total = 0;
    let id: string | null = null;
    for (const p of data ?? []) {
      total += Number(p.amount) || 0;
      if (!id && total >= MIN_PAYMENT_USD) id = String(p.id);
    }
    return { id, totalUsd: total };
  }

  private issue(userId: string, reference: string) {
    return this.ample.request('POST', `/users/${encodeURIComponent(this.key(userId))}/packs`, { kind: 'key' }, { body: { reference } });
  }

  /** The caller's pack for their first payment, issued on first call. { eligible:false } until a payment confirms or while Ample has no campaign. */
  async myPack(userId: string): Promise<{ eligible: boolean; pack: any | null; reason?: string; progressUsd?: number; requiredUsd?: number }> {
    if (!this.ample.isEnabled()) return { eligible: false, pack: null };
    const { id: reference, totalUsd } = await this.paymentState(userId);
    if (!reference) return { eligible: false, pack: null, progressUsd: Math.min(totalUsd, MIN_PAYMENT_USD), requiredUsd: MIN_PAYMENT_USD };
    try {
      let issued: any;
      try {
        issued = await this.issue(userId, reference);
      } catch (e: any) {
        if (e?.getResponse?.()?.code !== 'AMPLE_USER_NOT_LINKED') throw e;
        // First time on Ample: set up and link the person's Earn account on Base (no signature from them, gas is sponsored).
        await this.companion.ready(userId);
        issued = await this.issue(userId, reference);
      }
      const id = String(issued?.id ?? '');
      const detail = id ? await this.ample.request('GET', `/me/packs/${encodeURIComponent(id)}`, this.read(userId)).catch(() => issued) : issued;
      return { eligible: true, pack: detail ?? issued };
    } catch (e: any) {
      const code = e?.getResponse?.()?.code as string | undefined;
      if (code?.startsWith('AMPLE_PACK_')) return { eligible: false, pack: null, reason: code, progressUsd: Math.min(totalUsd, MIN_PAYMENT_USD), requiredUsd: MIN_PAYMENT_USD };
      this.logger.warn(`pack lookup failed for ${userId}: ${e?.message ?? e}`);
      throw e;
    }
  }

  /** Packs being opened right now, so a double click or two tabs can never open one pack twice. */
  private readonly opening = new Set<string>();

  /** One rip per pack. A pack that is already opened is returned as it is, Ample is not asked to open it again. */
  async openPack(userId: string, packId: string): Promise<any> {
    const mine = await this.myPack(userId);
    if (!mine.eligible || !mine.pack || String(mine.pack.id) !== packId) throw new BadRequestException('That pack is not yours');
    if (String(mine.pack.status) !== 'UNOPENED') return mine.pack;
    if (this.opening.has(packId)) throw new BadRequestException('This pack is already being opened');
    this.opening.add(packId);
    try {
      return await this.ample.request('POST', `/me/packs/${encodeURIComponent(packId)}/open`, this.packs(userId), { body: {} });
    } finally {
      this.opening.delete(packId);
    }
  }
}
