import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';

/** What IntegratorGuard attaches to the request — never the raw key or its hash. */
export interface AuthenticatedIntegrator {
  id: string;
  name: string;
  scopes: string[];
  rateLimitPerMin: number;
  isDevnetOnly: boolean;
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
      .select('id, name, scopes, rate_limit_per_min, is_devnet_only, status')
      .eq('id', keyRow.integrator_id)
      .maybeSingle();
    if (!integrator || integrator.status !== 'active') return null;

    return {
      id: integrator.id,
      name: integrator.name,
      scopes: integrator.scopes ?? [],
      rateLimitPerMin: integrator.rate_limit_per_min,
      isDevnetOnly: integrator.is_devnet_only,
    };
  }

  /**
   * Mints a new integrator plus its first API key, returning the raw key exactly once.
   * Nothing else ever reconstructs it; only its hash is persisted. Called both by admin
   * provisioning and by the self-serve org dashboard (params.organizationId set in that case).
   */
  async provision(params: {
    name: string;
    contactEmail?: string;
    isDevnetOnly?: boolean;
    rateLimitPerMin?: number;
    createdByAdmin: string;
    organizationId?: string;
  }): Promise<{ integratorId: string; rawKey: string; keyPrefix: string }> {
    const isDevnetOnly = params.isDevnetOnly ?? true;

    const { data: integrator, error } = await this.supabase.integrators
      .insert({
        name: params.name,
        contact_email: params.contactEmail ?? null,
        is_devnet_only: isDevnetOnly,
        rate_limit_per_min: params.rateLimitPerMin ?? 60,
        created_by_admin: params.createdByAdmin,
        ...(params.organizationId ? { organization_id: params.organizationId } : {}),
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

  private generateRawKey(isDevnetOnly: boolean): string {
    const prefix = isDevnetOnly ? KEY_PREFIX_TEST : KEY_PREFIX_LIVE;
    return `${prefix}${randomBytes(32).toString('base64url')}`;
  }
}
