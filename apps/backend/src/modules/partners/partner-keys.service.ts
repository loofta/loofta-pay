import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { IntegratorsService } from '@/modules/integrators/integrators.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { PartnerWebhooksService } from '@/modules/payouts/partner-webhooks.service';
import { PartnersService } from './partners.service';

export const PARTNER_KEY_SCOPES = ['portal:token'];
/** Extra scope, off by default: lets the partner's server draft payout batches (never approve or fund them). */
export const PARTNER_BATCH_SCOPES = ['batches:write'];
const MAX_ACTIVE_KEYS = 3;

/**
 * API keys for a partner's own server. A partner key can only mint widget tokens for the partner's
 * users (scope portal:token): it cannot create payouts or move money. Raw keys are shown once.
 */
@Injectable()
export class PartnerKeysService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly partners: PartnersService,
    private readonly integrators: IntegratorsService,
    private readonly config: ConfigService,
    private readonly webhooks: PartnerWebhooksService,
  ) {}

  async list(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'keys.manage');
    if (!partner.integrator_id) return [];
    const { data } = await this.supabase.integratorApiKeys
      .select('id, key_prefix, created_at')
      .eq('integrator_id', partner.integrator_id)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    return (data ?? []).map((k) => ({ id: k.id as string, prefix: k.key_prefix as string, created_at: k.created_at as string }));
  }

  /** Whether this partner's keys may draft payout batches. Owner only: it widens what a leaked key can do. */
  async getApiAccess(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'keys.manage');
    if (!partner.integrator_id) return { payout_batches: false };
    const { data } = await this.supabase.integrators.select('scopes').eq('id', partner.integrator_id).maybeSingle();
    return { payout_batches: ((data?.scopes as string[] | null) ?? []).includes('batches:write') };
  }

  async setApiAccess(orgId: string, userId: string, payoutBatches: boolean) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'treasury.manage');
    if (!partner.integrator_id) throw new BadRequestException('Create an API key first.');
    const scopes = payoutBatches ? [...PARTNER_KEY_SCOPES, ...PARTNER_BATCH_SCOPES] : PARTNER_KEY_SCOPES;
    const { error } = await this.supabase.integrators.update({ scopes }).eq('id', partner.integrator_id);
    if (error) throw new BadRequestException('Could not save this setting.');
    await this.partners.audit(partner.id, userId, payoutBatches ? 'api_access.batches_enabled' : 'api_access.batches_disabled');
    return { payout_batches: payoutBatches };
  }

  /** The webhook URL, its signing secret, and how the last events went. Owners and admins only. */
  async getWebhook(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'keys.manage');
    if (!partner.integrator_id) return { url: null, secret: null, recent: [] };
    const { data: settings } = await this.supabase.partnerSettings.select('webhook_url, webhook_secret').eq('integrator_id', partner.integrator_id).maybeSingle();
    const { data: recent } = await this.supabase.payoutWebhookEvents
      .select('id, event_type, status, attempts, last_error, created_at, delivered_at')
      .eq('integrator_id', partner.integrator_id)
      .order('created_at', { ascending: false })
      .limit(15);
    return {
      url: (settings?.webhook_url as string | null) ?? null,
      secret: (settings?.webhook_secret as string | null) ?? null,
      recent: recent ?? [],
    };
  }

  async setWebhook(orgId: string, userId: string, url: string | null) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'keys.manage');
    return this.setWebhookForPartner(partner, url, userId);
  }

  async setWebhookForIntegrator(integratorId: string, url: string | null) {
    const { data } = await this.supabase.partners.select('id, integrator_id, status').eq('integrator_id', integratorId).maybeSingle();
    if (!data || (data as { status: string }).status !== 'active') throw new NotFoundException('Partner not found.');
    return this.setWebhookForPartner(data as { id: string; integrator_id: string | null }, url, null);
  }

  /** Used by both the portal and a partner's own API key. The URL is checked to be a public https address. */
  async setWebhookForPartner(partner: { id: string; integrator_id: string | null }, url: string | null, userId: string | null) {
    if (!partner.integrator_id) throw new BadRequestException('Create an API key first.');
    const clean = url?.trim() || null;
    const out = await this.webhooks.setWebhookUrl(partner.integrator_id, clean);
    await this.partners.audit(partner.id, userId, clean ? 'webhook.set' : 'webhook.cleared', undefined, clean ? { host: new URL(clean).host } : undefined);
    return { url: out.webhook_url, secret: out.webhook_secret };
  }

  async create(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'keys.manage');
    const devnetOnly = isSolanaDevnetFromConfig(this.config);

    let integratorId = partner.integrator_id;
    let first: { rawKey: string; keyPrefix: string } | null = null;
    if (!integratorId) {
      const made = await this.integrators.provision({
        name: `Partner: ${partner.name}`.slice(0, 120),
        isDevnetOnly: devnetOnly,
        rateLimitPerMin: 120,
        createdByAdmin: `partner:${partner.org_id}`,
      });
      await this.supabase.integrators.update({ scopes: PARTNER_KEY_SCOPES }).eq('id', made.integratorId);
      const { data: linked } = await this.supabase.partners
        .update({ integrator_id: made.integratorId })
        .eq('id', partner.id)
        .is('integrator_id', null)
        .select('id');
      if (!linked?.length) {
        // A concurrent request linked its own integrator first. Revoke ours and use theirs.
        const { data: keys } = await this.supabase.integratorApiKeys.select('id').eq('integrator_id', made.integratorId);
        for (const k of keys ?? []) await this.integrators.revokeKey(k.id as string);
        throw new ConflictException('An API key was just created. Reload and try again.');
      }
      integratorId = made.integratorId;
      first = { rawKey: made.rawKey, keyPrefix: made.keyPrefix };
    } else {
      const active = await this.list(orgId, userId);
      if (active.length >= MAX_ACTIVE_KEYS) throw new BadRequestException(`You can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`);
    }

    const key = first ?? (await this.integrators.mintAdditionalKey(integratorId, devnetOnly));
    await this.partners.audit(partner.id, userId, 'api_key.created', { type: 'api_key', id: key.keyPrefix });
    return { api_key: key.rawKey, prefix: key.keyPrefix };
  }

  async revoke(orgId: string, userId: string, keyId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'keys.manage');
    if (!partner.integrator_id) throw new NotFoundException('Key not found.');
    const { data: row } = await this.supabase.integratorApiKeys.select('id, key_prefix').eq('id', keyId).eq('integrator_id', partner.integrator_id).maybeSingle();
    if (!row) throw new NotFoundException('Key not found.');
    await this.integrators.revokeKey(keyId);
    await this.partners.audit(partner.id, userId, 'api_key.revoked', { type: 'api_key', id: row.key_prefix as string });
    return { ok: true };
  }
}
