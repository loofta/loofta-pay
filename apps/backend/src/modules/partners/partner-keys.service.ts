import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { IntegratorsService } from '@/modules/integrators/integrators.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { PartnersService } from './partners.service';

export const PARTNER_KEY_SCOPES = ['portal:token'];
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
