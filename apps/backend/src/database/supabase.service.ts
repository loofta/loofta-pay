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

  get users() {
    return this.client.from('users');
  }

  get appUsers() {
    return this.client.from('app_users');
  }

  get payrollBatches() {
    return this.client.from('payroll_batches');
  }

  get payrollRecipients() {
    return this.client.from('payroll_recipients');
  }
}
