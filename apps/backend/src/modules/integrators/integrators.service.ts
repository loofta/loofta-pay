import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';

const SELF_SERVE_SCOPES = ['payment_links:create'];

/** What IntegratorGuard attaches to the request — never the raw key or its hash. */
export interface AuthenticatedIntegrator {
  id: string;
  name: string;
  scopes: string[];
  rateLimitPerMin: number;
  isDevnetOnly: boolean;
  /** Privy user id for a self-serve integrator; null for admin-provisioned trusted partners. */
  ownerUserId: string | null;
  /** organizations.id backing this integrator's merchant branding (logo/name), if any is set. */
  organizationId: string | null;
}

const KEY_PREFIX_LIVE = 'lft_live_';
const KEY_PREFIX_TEST = 'lft_test_';

@Injectable()
export class IntegratorsService {
  private readonly logger = new Logger(IntegratorsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  /**
   * HMAC-SHA256(rawKey, pepper) rather than a plain hash, so a leaked integrator_api_keys
   * table alone doesn't let an attacker offline-brute-force keys — the pepper only ever
   * lives in server config, never in the database.
   */
  private hashKey(rawKey: string): string {
    const pepper = this.config.get<string>('INTEGRATOR_KEY_PEPPER');
    if (!pepper) throw new Error('INTEGRATOR_KEY_PEPPER not configured');
    return createHmac('sha256', pepper).update(rawKey).digest('hex');
  }

  /** Verifies a raw bearer key against the DB and returns the active integrator it belongs to. */
  async findActiveByRawKey(rawKey: string): Promise<AuthenticatedIntegrator | null> {
    let keyHash: string;
    try {
      keyHash = this.hashKey(rawKey);
    } catch (err) {
      this.logger.error(`Cannot verify integrator key: ${(err as Error).message}`);
      return null;
    }

    const { data: keyRow } = await this.supabase.integratorApiKeys
      .select('integrator_id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .maybeSingle();
    if (!keyRow) return null;

    const { data: integrator } = await this.supabase.integrators
      .select('id, name, scopes, rate_limit_per_min, is_devnet_only, status, owner_user_id, organization_id')
      .eq('id', keyRow.integrator_id)
      .maybeSingle();
    if (!integrator || integrator.status !== 'active') return null;

    return {
      id: integrator.id,
      name: integrator.name,
      scopes: integrator.scopes ?? [],
      rateLimitPerMin: integrator.rate_limit_per_min,
      isDevnetOnly: integrator.is_devnet_only,
      ownerUserId: integrator.owner_user_id ?? null,
      organizationId: integrator.organization_id ?? null,
    };
  }

  /**
   * Internal provisioning only (no public self-serve yet) — mints a new integrator plus its
   * first API key, returning the raw key exactly once. Nothing else ever reconstructs it;
   * only its hash is persisted.
   */
  async provision(params: {
    name: string;
    contactEmail?: string;
    isDevnetOnly?: boolean;
    rateLimitPerMin?: number;
    createdByAdmin: string;
  }): Promise<{ integratorId: string; rawKey: string; keyPrefix: string }> {
    const isDevnetOnly = params.isDevnetOnly ?? true;

    const { data: integrator, error } = await this.supabase.integrators
      .insert({
        name: params.name,
        contact_email: params.contactEmail ?? null,
        is_devnet_only: isDevnetOnly,
        rate_limit_per_min: params.rateLimitPerMin ?? 60,
        created_by_admin: params.createdByAdmin,
      })
      .select('id')
      .single();
    if (error || !integrator) {
      throw new Error(`Failed to create integrator: ${error?.message ?? 'unknown error'}`);
    }

    const rawKey = this.generateRawKey(isDevnetOnly);
    const keyPrefix = rawKey.slice(0, 12);
    const { error: keyError } = await this.supabase.integratorApiKeys.insert({
      integrator_id: integrator.id,
      key_hash: this.hashKey(rawKey),
      key_prefix: keyPrefix,
    });
    if (keyError) {
      throw new Error(`Failed to create integrator API key: ${keyError.message}`);
    }

    this.logger.log(`Provisioned integrator ${integrator.id} (${params.name}, devnetOnly=${isDevnetOnly})`);
    return { integratorId: integrator.id, rawKey, keyPrefix };
  }

  /** Mints an additional key for an existing integrator (rotation without a hard cutover). */
  async mintAdditionalKey(integratorId: string, isDevnetOnly: boolean): Promise<{ rawKey: string; keyPrefix: string }> {
    const rawKey = this.generateRawKey(isDevnetOnly);
    const keyPrefix = rawKey.slice(0, 12);
    const { error } = await this.supabase.integratorApiKeys.insert({
      integrator_id: integratorId,
      key_hash: this.hashKey(rawKey),
      key_prefix: keyPrefix,
    });
    if (error) throw new Error(`Failed to mint integrator API key: ${error.message}`);
    return { rawKey, keyPrefix };
  }

  async revokeKey(keyId: string): Promise<void> {
    await this.supabase.integratorApiKeys
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyId);
  }

  /**
   * Self-serve provisioning: find-or-create the one integrator row owned by this user (the
   * unique index on owner_user_id enforces one-per-user) and mint its first key. Live (mainnet)
   * keys — there's no devnet/sandbox mode for this product: NEAR Intents settlement is always
   * real money moving on real chains, so a "test" key here would just be a live key with
   * misleading labeling, not an actually-safe sandbox.
   */
  async provisionSelfServe(ownerUserId: string): Promise<{ integratorId: string; rawKey: string; keyPrefix: string }> {
    const existing = await this.findSelfServeByOwner(ownerUserId);
    if (existing) {
      const { rawKey, keyPrefix } = await this.mintAdditionalKey(existing.id, false);
      return { integratorId: existing.id, rawKey, keyPrefix };
    }

    const { data: integrator, error } = await this.supabase.integrators
      .insert({
        name: `self-serve:${ownerUserId}`,
        owner_user_id: ownerUserId,
        scopes: SELF_SERVE_SCOPES,
        is_devnet_only: false,
        rate_limit_per_min: 30,
      })
      .select('id')
      .single();
    if (error || !integrator) {
      throw new Error(`Failed to provision self-serve integrator: ${error?.message ?? 'unknown error'}`);
    }

    const rawKey = this.generateRawKey(false);
    const keyPrefix = rawKey.slice(0, 12);
    const { error: keyError } = await this.supabase.integratorApiKeys.insert({
      integrator_id: integrator.id,
      key_hash: this.hashKey(rawKey),
      key_prefix: keyPrefix,
    });
    if (keyError) throw new Error(`Failed to create self-serve API key: ${keyError.message}`);

    this.logger.log(`Provisioned self-serve integrator ${integrator.id} for user ${ownerUserId}`);
    return { integratorId: integrator.id, rawKey, keyPrefix };
  }

  /** Active (non-revoked) keys for the self-serve integrator owned by this user, if any. */
  async findSelfServeByOwner(ownerUserId: string): Promise<{ id: string; keys: { id: string; keyPrefix: string }[] } | null> {
    const { data: integrator } = await this.supabase.integrators
      .select('id')
      .eq('owner_user_id', ownerUserId)
      .maybeSingle();
    if (!integrator) return null;
    const { data: keys } = await this.supabase.integratorApiKeys
      .select('id, key_prefix')
      .eq('integrator_id', integrator.id)
      .is('revoked_at', null);
    return { id: integrator.id, keys: (keys ?? []).map((k) => ({ id: k.id as string, keyPrefix: k.key_prefix as string })) };
  }

  async rotateSelfServeKey(ownerUserId: string): Promise<{ rawKey: string; keyPrefix: string }> {
    const existing = await this.findSelfServeByOwner(ownerUserId);
    if (!existing) throw new NotFoundException('No API key provisioned yet — create one first');
    return this.mintAdditionalKey(existing.id, false);
  }

  /** Ownership-checked revoke — a self-serve caller may only revoke keys on their own integrator. */
  async revokeSelfServeKey(ownerUserId: string, keyId: string): Promise<void> {
    const { data: keyRow } = await this.supabase.integratorApiKeys
      .select('id, integrator_id')
      .eq('id', keyId)
      .maybeSingle();
    if (!keyRow) throw new NotFoundException('Key not found');

    const { data: integrator } = await this.supabase.integrators
      .select('owner_user_id')
      .eq('id', keyRow.integrator_id)
      .maybeSingle();
    if (!integrator || integrator.owner_user_id !== ownerUserId) {
      throw new NotFoundException('Key not found');
    }

    await this.revokeKey(keyId);
  }

  /**
   * Merchant branding for self-serve payment links — reuses the existing organizations table
   * (name, logo_url) rather than duplicating those columns onto integrators; an integrator gets
   * its own organizations row lazily, the first time it sets branding.
   */
  async getSelfServeBranding(ownerUserId: string): Promise<{ name: string; logoUrl: string | null } | null> {
    const { data: integrator } = await this.supabase.integrators
      .select('organization_id')
      .eq('owner_user_id', ownerUserId)
      .maybeSingle();
    if (!integrator?.organization_id) return null;
    const { data: org } = await this.supabase.organizations
      .select('name, logo_url')
      .eq('id', integrator.organization_id)
      .maybeSingle();
    if (!org) return null;
    return { name: org.name, logoUrl: org.logo_url ?? null };
  }

  async updateSelfServeBranding(ownerUserId: string, branding: { name?: string; logoUrl?: string }): Promise<{ name: string; logoUrl: string | null }> {
    const { data: integrator } = await this.supabase.integrators
      .select('id, organization_id')
      .eq('owner_user_id', ownerUserId)
      .maybeSingle();
    if (!integrator) throw new NotFoundException('No API key provisioned yet — create one first');

    let organizationId = integrator.organization_id as string | null;
    if (!organizationId) {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let orgReferral = 'org_';
      for (let i = 0; i < 16; i++) orgReferral += chars.charAt(Math.floor(Math.random() * chars.length));

      const { data: org, error } = await this.supabase.organizations
        .insert({
          organization_id: `merchant-${randomBytes(6).toString('hex')}`,
          name: branding.name || 'My business',
          logo_url: branding.logoUrl || null,
          checkout_status: 'inactive', // unused by payment-links, just satisfies the not-null default
          org_referral: orgReferral,
          created_by: ownerUserId,
        })
        .select('id, name, logo_url')
        .single();
      if (error || !org) throw new Error(`Failed to create organization for branding: ${error?.message}`);

      organizationId = org.id as string;
      await this.supabase.integrators.update({ organization_id: organizationId }).eq('id', integrator.id);
      return { name: org.name, logoUrl: org.logo_url ?? null };
    }

    const updates: Record<string, unknown> = {};
    if (branding.name !== undefined) updates.name = branding.name;
    if (branding.logoUrl !== undefined) updates.logo_url = branding.logoUrl || null;
    const { data, error } = await this.supabase.organizations
      .update(updates)
      .eq('id', organizationId)
      .select('name, logo_url')
      .single();
    if (error || !data) throw new Error(`Failed to update branding: ${error?.message}`);
    return { name: data.name, logoUrl: data.logo_url ?? null };
  }

  private generateRawKey(isDevnetOnly: boolean): string {
    const prefix = isDevnetOnly ? KEY_PREFIX_TEST : KEY_PREFIX_LIVE;
    return `${prefix}${randomBytes(32).toString('base64url')}`;
  }
}
