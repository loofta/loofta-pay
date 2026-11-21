import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { assertSafePublicUrl } from '@/common/assert-safe-public-url';
import { safeHttpsGet } from '@/common/safe-https-get';
import { PartnersService } from './partners.service';
import { parseRecipientFeed } from './partner-recipient-feed';
import { RecipientInputDto } from './dto/partner.dto';

export const MAX_GROUPS_PER_PARTNER = 50;
export const MAX_MEMBERS_PER_GROUP = 1000;
/** A linked list can be read at most once a minute per group. */
export const SYNC_COOLDOWN_MS = 60_000;

type GroupRow = {
  id: string;
  partner_id: string;
  name: string;
  source_url: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_count: number | null;
  created_at: string;
};

/**
 * Recipient groups: named lists of a partner's recipients, optionally mirrored from a URL the partner controls.
 *
 * Safety model:
 *  - Every route resolves the caller's membership and role first, and every group query is also filtered by the partner
 *    the caller belongs to, so another company's group id answers "not found", never data.
 *  - A group only holds references to recipients. It never creates a payout or moves money; a batch is still drafted,
 *    approved and paid the normal way, and its rows are validated again there.
 *  - The linked URL is a secret (it may carry a token), so it is never sent back after it is saved: the API only says
 *    which host a group is linked to.
 *  - The URL is read by our server, so reading it goes through safeHttpsGet (https, public hosts only, connect-time
 *    address check, no redirects, size and time limits), at most once a minute per group, and a failed or empty read
 *    never changes the group.
 */
@Injectable()
export class PartnerGroupsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly partners: PartnersService,
  ) {}

  private view(g: GroupRow, memberCount: number) {
    let host: string | null = null;
    if (g.source_url) {
      try { host = new URL(g.source_url).hostname; } catch { host = null; }
    }
    return {
      id: g.id,
      name: g.name,
      member_count: memberCount,
      linked: !!g.source_url,
      source_host: host,
      last_synced_at: g.last_synced_at,
      last_sync_status: g.last_sync_status,
      last_sync_count: g.last_sync_count,
      created_at: g.created_at,
    };
  }

  private async loadGroup(partnerId: string, groupId: string): Promise<GroupRow> {
    const { data } = await this.supabase.partnerRecipientGroups.select('*').eq('id', groupId).eq('partner_id', partnerId).maybeSingle();
    if (!data) throw new NotFoundException('Group not found.');
    return data as GroupRow;
  }

  private async countMembers(groupId: string): Promise<number> {
    const { count } = await this.supabase.partnerRecipientGroupMembers.select('recipient_id', { count: 'exact', head: true }).eq('group_id', groupId);
    return count ?? 0;
  }

  private cleanName(name: string): string {
    const n = name.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
    if (n.length < 1 || n.length > 60) throw new BadRequestException('A group name is 1 to 60 characters.');
    return n;
  }

  async list(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'view');
    const { data } = await this.supabase.partnerRecipientGroups.select('*').eq('partner_id', partner.id).order('created_at', { ascending: false }).limit(MAX_GROUPS_PER_PARTNER);
    const groups = (data ?? []) as GroupRow[];
    const out = [];
    for (const g of groups) out.push(this.view(g, await this.countMembers(g.id)));
    return { groups: out };
  }

  async create(orgId: string, userId: string, dto: { name: string; source_url?: string }) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'recipients.manage');
    const name = this.cleanName(dto.name);
    const url = dto.source_url ? assertSafePublicUrl(dto.source_url, 'source_url').toString() : null;
    const { count } = await this.supabase.partnerRecipientGroups.select('id', { count: 'exact', head: true }).eq('partner_id', partner.id);
    if ((count ?? 0) >= MAX_GROUPS_PER_PARTNER) throw new BadRequestException(`You can have up to ${MAX_GROUPS_PER_PARTNER} groups.`);
    const { data, error } = await this.supabase.partnerRecipientGroups
      .insert({ partner_id: partner.id, name, source_url: url, created_by: userId })
      .select('*')
      .single();
    if (error || !data) {
      if (error?.code === '23505') throw new ConflictException('You already have a group with that name.');
      throw new BadRequestException('Could not create the group.');
    }
    await this.partners.audit(partner.id, userId, 'group.created', { type: 'group', id: data.id }, { name, linked: !!url });
    return this.view(data as GroupRow, 0);
  }

  async update(orgId: string, userId: string, groupId: string, dto: { name?: string; source_url?: string }) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'recipients.manage');
    const group = await this.loadGroup(partner.id, groupId);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = this.cleanName(dto.name);
    if (dto.source_url !== undefined) patch.source_url = dto.source_url === '' ? null : assertSafePublicUrl(dto.source_url, 'source_url').toString();
    if (!Object.keys(patch).length) throw new BadRequestException('Nothing to change.');
    const { data, error } = await this.supabase.partnerRecipientGroups.update(patch).eq('id', group.id).eq('partner_id', partner.id).select('*').single();
    if (error || !data) {
      if (error?.code === '23505') throw new ConflictException('You already have a group with that name.');
      throw new BadRequestException('Could not update the group.');
    }
    await this.partners.audit(partner.id, userId, 'group.updated', { type: 'group', id: group.id }, { renamed: dto.name !== undefined, link_changed: dto.source_url !== undefined });
    return this.view(data as GroupRow, await this.countMembers(group.id));
  }

  async remove(orgId: string, userId: string, groupId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'recipients.manage');
    const group = await this.loadGroup(partner.id, groupId);
    await this.supabase.partnerRecipientGroups.delete().eq('id', group.id).eq('partner_id', partner.id);
    await this.partners.audit(partner.id, userId, 'group.deleted', { type: 'group', id: group.id }, { name: group.name });
    return { ok: true };
  }

  async members(orgId: string, userId: string, groupId: string, limit = 500, offset = 0) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'view');
    const group = await this.loadGroup(partner.id, groupId);
    const { data: links } = await this.supabase.partnerRecipientGroupMembers
      .select('recipient_id')
      .eq('group_id', group.id)
      .order('added_at', { ascending: false })
      .range(Math.max(0, offset), Math.max(0, offset) + Math.min(Math.max(1, limit), 1000) - 1);
    const ids = (links ?? []).map((l) => l.recipient_id as string);
    if (!ids.length) return { group: this.view(group, 0), recipients: [] };
    const { data: rows } = await this.supabase.partnerRecipients
      .select('id, display_name, email, handle_platform, handle, external_user_id')
      .eq('partner_id', partner.id)
      .in('id', ids);
    return { group: this.view(group, await this.countMembers(group.id)), recipients: rows ?? [] };
  }

  private async attach(partnerId: string, groupId: string, recipientIds: string[]) {
    if (!recipientIds.length) return 0;
    // Only ever attach recipients that belong to this same partner.
    const { data: mine } = await this.supabase.partnerRecipients.select('id').eq('partner_id', partnerId).in('id', recipientIds);
    const valid = (mine ?? []).map((r) => r.id as string);
    if (!valid.length) return 0;
    const existing = await this.countMembers(groupId);
    if (existing + valid.length > MAX_MEMBERS_PER_GROUP) throw new BadRequestException(`A group can have up to ${MAX_MEMBERS_PER_GROUP} people.`);
    const { error } = await this.supabase.partnerRecipientGroupMembers.upsert(
      valid.map((recipient_id) => ({ group_id: groupId, recipient_id })),
      { onConflict: 'group_id,recipient_id', ignoreDuplicates: true },
    );
    if (error) throw new BadRequestException('Could not add people to the group.');
    return valid.length;
  }

  async addMembers(orgId: string, userId: string, groupId: string, dto: { recipients?: RecipientInputDto[]; recipient_ids?: string[] }) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'recipients.manage');
    const group = await this.loadGroup(partner.id, groupId);
    const ids = new Set<string>(dto.recipient_ids ?? []);
    let errors: Array<{ row: number; error: string }> = [];
    if (dto.recipients?.length) {
      const r = await this.partners.upsertRecipientRows(partner.id, dto.recipients);
      r.ids.forEach((id) => ids.add(id));
      errors = r.errors;
    }
    const added = await this.attach(partner.id, group.id, [...ids]);
    await this.partners.audit(partner.id, userId, 'group.members_added', { type: 'group', id: group.id }, { added, failed: errors.length });
    return { added, failed: errors.length, errors };
  }

  async removeMember(orgId: string, userId: string, groupId: string, recipientId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'recipients.manage');
    const group = await this.loadGroup(partner.id, groupId);
    await this.supabase.partnerRecipientGroupMembers.delete().eq('group_id', group.id).eq('recipient_id', recipientId);
    return { ok: true };
  }

  /**
   * Reads the linked URL and makes the group match it. People who are new become recipients, people no longer in the
   * list leave the group (they stay recipients). A failed, invalid or empty read changes nothing.
   */
  async sync(orgId: string, userId: string, groupId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'recipients.manage');
    const group = await this.loadGroup(partner.id, groupId);
    if (!group.source_url) throw new BadRequestException('This group is not linked to a URL.');

    // Take the sync slot first, atomically, so two clicks (or a script) can not run reads in parallel or hammer the host.
    const now = new Date();
    const cutoff = new Date(now.getTime() - SYNC_COOLDOWN_MS).toISOString();
    const { data: slot } = await this.supabase.partnerRecipientGroups
      .update({ last_synced_at: now.toISOString(), last_sync_status: 'running' })
      .eq('id', group.id)
      .eq('partner_id', partner.id)
      .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
      .select('id');
    if (!slot?.length) throw new HttpException('This list was read a moment ago. Try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);

    const fail = async (message: string): Promise<never> => {
      await this.supabase.partnerRecipientGroups.update({ last_sync_status: 'failed' }).eq('id', group.id).eq('partner_id', partner.id);
      await this.partners.audit(partner.id, userId, 'group.sync_failed', { type: 'group', id: group.id });
      throw new BadRequestException(message);
    };

    let parsed: ReturnType<typeof parseRecipientFeed>;
    try {
      const res = await safeHttpsGet(group.source_url);
      parsed = parseRecipientFeed(res.body, res.contentType);
    } catch (e) {
      return fail(e instanceof HttpException ? String((e.getResponse() as { message?: string }).message ?? e.message) : 'Could not read that list.');
    }
    if (!parsed.rows.length) return fail('That list had no valid people, so the group was left as it was.');

    const r = await this.partners.upsertRecipientRows(partner.id, parsed.rows as RecipientInputDto[]);
    const keep = new Set(r.ids);
    const { data: current } = await this.supabase.partnerRecipientGroupMembers.select('recipient_id').eq('group_id', group.id);
    const have = new Set((current ?? []).map((m) => m.recipient_id as string));
    const toRemove = [...have].filter((id) => !keep.has(id));
    const toAdd = [...keep].filter((id) => !have.has(id));
    if (toRemove.length) await this.supabase.partnerRecipientGroupMembers.delete().eq('group_id', group.id).in('recipient_id', toRemove);
    if (toAdd.length) {
      const { error } = await this.supabase.partnerRecipientGroupMembers.upsert(toAdd.map((recipient_id) => ({ group_id: group.id, recipient_id })), { onConflict: 'group_id,recipient_id', ignoreDuplicates: true });
      if (error) return fail('Could not update the group.');
    }
    await this.supabase.partnerRecipientGroups.update({ last_sync_status: 'ok', last_sync_count: keep.size }).eq('id', group.id).eq('partner_id', partner.id);
    await this.partners.audit(partner.id, userId, 'group.synced', { type: 'group', id: group.id }, { people: keep.size, added: toAdd.length, removed: toRemove.length, skipped: parsed.errors.length + r.errors.length });
    return { people: keep.size, added: toAdd.length, removed: toRemove.length, skipped: parsed.errors.length + r.errors.length, errors: parsed.errors };
  }
}
