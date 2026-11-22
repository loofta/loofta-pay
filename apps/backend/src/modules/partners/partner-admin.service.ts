import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { PartnersService } from './partners.service';

export type ReviewAction = 'approve' | 'reject' | 'suspend' | 'reinstate';

/** The status each action moves a company to, and the statuses it may start from. */
const TRANSITIONS: Record<ReviewAction, { from: string[]; to: string }> = {
  approve: { from: ['pending'], to: 'active' },
  reject: { from: ['pending'], to: 'rejected' },
  suspend: { from: ['active'], to: 'suspended' },
  reinstate: { from: ['suspended', 'rejected'], to: 'active' },
};

const LIST_COLUMNS =
  'id, org_id, name, logo_url, status, website, contact_email, legal_name, country, use_case, review_note, applied_at, reviewed_at, reviewed_by, integrator_id, treasury_multisig, owner_user_id';

/**
 * Loofta reviews every company by hand before it can create an API key, a company wallet, a batch or send an invite.
 * There is no self-serve path: the portal creates a `pending` company, and only an admin moves it to `active`.
 */
@Injectable()
export class PartnerAdminService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly partners: PartnersService,
  ) {}

  async list(status?: string) {
    let q = this.supabase.partners.select(LIST_COLUMNS).order('applied_at', { ascending: false }).limit(200);
    if (status && ['pending', 'active', 'rejected', 'suspended'].includes(status)) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new BadRequestException('Could not load companies.');
    const rows = (data ?? []) as Array<Record<string, unknown> & { id: string; owner_user_id: string }>;
    const ids = rows.map((r) => r.id);
    const counts: Record<string, number> = {};
    if (ids.length) {
      const { data: batches } = await this.supabase.payoutBatches.select('partner_id').in('partner_id', ids);
      for (const b of batches ?? []) counts[b.partner_id as string] = (counts[b.partner_id as string] ?? 0) + 1;
    }
    return rows.map((r) => ({ ...r, batches: counts[r.id] ?? 0, has_api_key: !!r.integrator_id, has_company_wallet: !!r.treasury_multisig }));
  }

  async review(partnerId: string, action: ReviewAction, adminUserId: string, note?: string) {
    const t = TRANSITIONS[action];
    if (!t) throw new BadRequestException('Unknown action.');
    const cleanNote = note?.trim().slice(0, 500) || null;
    if ((action === 'reject' || action === 'suspend') && !cleanNote) throw new BadRequestException('Add a short note: it is kept in the audit log.');
    const patch: Record<string, unknown> = {
      status: t.to,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminUserId,
      review_note: cleanNote,
    };
    // First write wins: the status guard plus the row count stop two admins acting on the same company at once.
    const { data, error } = await this.supabase.partners.update(patch).eq('id', partnerId).in('status', t.from).select('id');
    if (error) throw new BadRequestException('Could not update this company.');
    if (!data?.length) {
      const { data: exists } = await this.supabase.partners.select('status').eq('id', partnerId).maybeSingle();
      if (!exists) throw new NotFoundException('Company not found.');
      throw new BadRequestException(`This company is ${(exists as { status: string }).status}, so it cannot be ${action}d.`);
    }
    await this.partners.audit(partnerId, adminUserId, `partner.${action}`, { type: 'partner', id: partnerId }, cleanNote ? { note: cleanNote } : {});
    return { id: partnerId, status: t.to };
  }
}
