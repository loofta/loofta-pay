import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { EmailService } from '@/modules/email/email.service';
import { PartnersService } from './partners.service';
import { KYC_FEE_USD, ZkmeService } from './zkme.service';

const MAX_REQUEST = 200;
const MAX_REFRESH = 25;
const OPEN = ['requested', 'in_progress', 'failed'];

type Partnerish = { id: string; org_id: string; name: string; kyc_enabled?: boolean };

/**
 * Identity checks for a partner's recipients, on request. Every route resolves the caller's role first and every
 * recipient query is filtered by the caller's own partner, so another company's ids answer "not found".
 * A person who was asked and has not passed cannot withdraw (see blockingFor).
 */
@Injectable()
export class PartnerKycService {
  private readonly logger = new Logger(PartnerKycService.name);
  constructor(
    private readonly supabase: SupabaseService,
    private readonly partners: PartnersService,
    private readonly zkme: ZkmeService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private withdrawUrl(orgId: string): string {
    const base = (this.config.get<string>('PAY_APP_URL') || 'https://pay.loofta.com').replace(/\/$/, '');
    return `${base}/app/withdraw?orgId=${encodeURIComponent(orgId)}`;
  }

  private async notify(partner: Partnerish, emails: string[]): Promise<number> {
    let sent = 0;
    for (const to of emails) {
      if (await this.email.sendPartnerKycRequestEmail({ recipientEmail: to, partnerName: partner.name, url: this.withdrawUrl(partner.org_id) })) sent++;
    }
    return sent;
  }

  async overview(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'view');
    const { data, error } = await this.supabase.partnerRecipients
      .select('id, display_name, email, handle_platform, handle, kyc_status, kyc_requested_at, kyc_passed_at, kyc_fee_usd')
      .eq('partner_id', partner.id)
      .neq('kyc_status', 'not_requested')
      .order('kyc_requested_at', { ascending: false })
      .limit(500);
    if (error) {
      this.logger.error(`KYC overview failed: ${error.message}`);
      throw new BadRequestException('Could not load identity checks.');
    }
    const rows = data ?? [];
    const count = (s: string) => rows.filter((r) => r.kyc_status === s).length;
    return {
      enabled: Boolean((partner as { kyc_enabled?: boolean }).kyc_enabled),
      available: this.zkme.isConfigured(),
      fee_usd: KYC_FEE_USD,
      counts: { requested: count('requested'), in_progress: count('in_progress'), passed: count('passed'), failed: count('failed') },
      owed_usd: Math.round(rows.reduce((s, r) => s + (Number(r.kyc_fee_usd) || 0), 0) * 100) / 100,
      recipients: rows,
    };
  }

  /** Ask for a check for these people and email each one. Only people with an email can be checked; the rest are reported back. */
  async request(orgId: string, userId: string, recipientIds: string[]) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'recipients.manage');
    if (!(partner as { kyc_enabled?: boolean }).kyc_enabled) throw new BadRequestException('Turn on identity checks first.');
    const ids = [...new Set(recipientIds)].slice(0, MAX_REQUEST);
    const { data, error } = await this.supabase.partnerRecipients.select('id, email, kyc_status').eq('partner_id', partner.id).in('id', ids);
    if (error) throw new BadRequestException('Could not load recipients.');
    const eligible = (data ?? []).filter((r) => r.email && (r.kyc_status === 'not_requested' || r.kyc_status === 'failed'));
    const skipped = ids.length - eligible.length;
    let emailed = 0;
    if (eligible.length) {
      const { error: upErr } = await this.supabase.partnerRecipients
        .update({ kyc_status: 'requested', kyc_requested_at: new Date().toISOString(), kyc_fee_usd: KYC_FEE_USD })
        .eq('partner_id', partner.id)
        .in('id', eligible.map((r) => r.id as string));
      if (upErr) throw new BadRequestException('Could not save.');
      await this.partners.audit(partner.id, userId, 'kyc.requested', undefined, { count: eligible.length });
      emailed = await this.notify(partner as unknown as Partnerish, eligible.map((r) => String(r.email).toLowerCase()));
    }
    return { requested: eligible.length, skipped, emailed };
  }

  /** Send the email again to people whose check is still open. */
  async resend(orgId: string, userId: string, recipientIds: string[]) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'recipients.manage');
    const ids = [...new Set(recipientIds)].slice(0, MAX_REQUEST);
    const { data } = await this.supabase.partnerRecipients.select('email').eq('partner_id', partner.id).in('id', ids).in('kyc_status', ['requested', 'in_progress']);
    const emails = (data ?? []).map((r) => r.email).filter(Boolean).map((e) => String(e).toLowerCase());
    return { emailed: await this.notify(partner as unknown as Partnerish, emails) };
  }

  /** Ask zkMe where each open check stands. A person already marked passed is never moved back. */
  async refresh(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'recipients.manage');
    const { data } = await this.supabase.partnerRecipients
      .select('id, email, kyc_status')
      .eq('partner_id', partner.id)
      .in('kyc_status', ['requested', 'in_progress'])
      .limit(MAX_REFRESH);
    return this.syncRows(partner.id, data ?? []);
  }

  private async syncRows(partnerId: string, rows: Array<{ id: unknown; email: unknown; kyc_status: unknown }>) {
    let updated = 0;
    for (const r of rows) {
      if (!r.email) continue;
      const next = await this.zkme.getStatusByEmail(String(r.email));
      const patch: Record<string, unknown> = { kyc_checked_at: new Date().toISOString() };
      if (next && next !== r.kyc_status) {
        patch.kyc_status = next;
        if (next === 'passed') patch.kyc_passed_at = new Date().toISOString();
        updated++;
      }
      await this.supabase.partnerRecipients.update(patch).eq('id', r.id as string).eq('partner_id', partnerId);
    }
    return { checked: rows.length, updated };
  }

  // ---- the recipient's side. `emails` are the addresses of payouts the signed-in person was already proven to own.

  /** The open checks (asked, not yet passed) that stand between these payout addresses and a withdrawal. */
  private async openRows(partnerId: string, emails: string[]) {
    const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (!list.length) return [];
    const { data, error } = await this.supabase.partnerRecipients.select('id, email, kyc_status').eq('partner_id', partnerId).in('email', list).in('kyc_status', OPEN);
    // Fail closed: if we cannot tell, nobody is waved through.
    if (error) throw new BadRequestException('Withdrawals are temporarily unavailable. Please try again soon.');
    return data ?? [];
  }

  /** Is this person asked to verify and not yet through? Null when the partner has the check off or nobody asked. */
  async blockingFor(partner: Partnerish, emails: string[]): Promise<{ status: string } | null> {
    if (!partner.kyc_enabled) return null;
    const rows = await this.openRows(partner.id, emails);
    if (!rows.length) return null;
    return { status: String(rows.find((r) => r.kyc_status === 'failed')?.kyc_status ?? rows[0].kyc_status) };
  }

  /** What the zkMe widget needs to start: a fresh token, the app, and the email the check is bound to. */
  async startForRecipient(partner: Partnerish, emails: string[]) {
    const rows = await this.openRows(partner.id, emails);
    if (!partner.kyc_enabled || !rows.length) throw new ForbiddenException('No identity check is waiting for you.');
    return { access_token: await this.zkme.getAccessToken(), email: String(rows[0].email).toLowerCase(), ...this.zkme.widgetConfig() };
  }

  /** The recipient says they finished. The answer always comes from zkMe, never from the browser. */
  async checkForRecipient(partner: Partnerish, emails: string[]) {
    const rows = await this.openRows(partner.id, emails);
    const r = await this.syncRows(partner.id, rows);
    return { ...r, passed: (await this.openRows(partner.id, emails)).length === 0 };
  }
}
