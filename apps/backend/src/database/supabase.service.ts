import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.getOrThrow<string>('SUPABASE_URL');
    // Support multiple possible env var names (like frontend does)
    const key =
      this.configService.get<string>('SUPABASE_SECRET') ||
      this.configService.get<string>('SUPABASE_SECRET_KEY') ||
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.configService.get<string>('SUPABASE_SERVICE_ROLE');

    if (!key) {
      throw new Error(
        'Missing Supabase secret key. Set one of: SUPABASE_SECRET, SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_SERVICE_ROLE',
      );
    }

    this.client = createClient(url, key, {
      auth: {
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    this.logger.log('Supabase client initialized');
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  // Convenience methods for common tables
  get organizations() {
    return this.client.from('organizations');
  }

  get claims() {
    return this.client.from('claims');
  }

  get claimIntents() {
    return this.client.from('claim_intents');
  }

  get payments() {
    return this.client.from('payments');
  }

  get paymentIntents() {
    return this.client.from('payment_intents');
  }

  get paymentEvents() {
    return this.client.from('payment_events');
  }

  get users() {
    return this.client.from('users');
  }

  get appUsers() {
    return this.client.from('app_users');
  }

  /**
   * Fetches every app_users row with a non-null privy_user_id, paging past
   * PostgREST's max_rows cap (1000) instead of silently truncating.
   */
  async getAllAppUsersWithPrivyId(): Promise<
    { privy_user_id: string; username: string | null; email: string | null }[]
  > {
    const pageSize = 1000;
    const all: { privy_user_id: string; username: string | null; email: string | null }[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.client
        .from('app_users')
        .select('privy_user_id, username, email')
        .not('privy_user_id', 'is', null)
        .order('privy_user_id', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      if (!data?.length) break;

      all.push(...data);
      if (data.length < pageSize) break;
    }

    return all;
  }

  get sendPaymentLinks() {
    return this.client.from('send_payment_links');
  }

  get mainnetWaitlist() {
    return this.client.from('mainnet_waitlist');
  }

  get claimEvents() {
    return this.client.from('claim_events');
  }

  get forceUpdate() {
    return this.client.from('force_update');
  }

  get socialAccounts() {
    return this.client.from('social_accounts');
  }

  get integrators() {
    return this.client.from('integrators');
  }

  get integratorApiKeys() {
    return this.client.from('integrator_api_keys');
  }
}
