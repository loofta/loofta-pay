import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';

@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async unsubscribe(email: string, source?: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const { error } = await this.supabase
      .getClient()
      .from('email_unsubscribes')
      .upsert({ email: normalized, source: source ?? null }, { onConflict: 'email', ignoreDuplicates: true });
    if (error) {
      this.logger.error(`Failed to record unsubscribe for ${normalized}: ${error.message}`);
      throw error;
    }
    this.logger.log(`Recorded unsubscribe for ${normalized}${source ? ` (source: ${source})` : ''}`);
  }

  /** All unsubscribed emails, lowercased, for filtering a marketing send's recipient list. */
  async getUnsubscribedEmails(): Promise<Set<string>> {
    const emails = new Set<string>();
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.supabase
        .getClient()
        .from('email_unsubscribes')
        .select('email')
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`Failed to fetch email_unsubscribes: ${error.message}`);
      for (const row of data ?? []) emails.add(row.email);
      if (!data || data.length < pageSize) break;
    }
    return emails;
  }
}
