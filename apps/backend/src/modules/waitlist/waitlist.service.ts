import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';

const VALID_SORT_COLS = new Set([
  'created_at', 'display_name', 'email', 'occupation', 'payment_volume', 'mainnet_access',
]);
const DEFAULT_LIMIT = 25;

export interface WaitlistListOptions {
  page?: number;
  limit?: number;
  search?: string;
  access?: 'all' | 'granted' | 'not_granted';
  sort_col?: string;
  sort_dir?: 'asc' | 'desc';
}

@Injectable()
export class WaitlistService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(opts: WaitlistListOptions = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
    const search = opts.search?.trim() ?? '';
    const access = opts.access ?? 'all';
    const sortCol = VALID_SORT_COLS.has(opts.sort_col ?? '') ? (opts.sort_col as string) : 'created_at';
    const sortAsc = opts.sort_dir === 'asc';

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = this.supabase.mainnetWaitlist.select('*', { count: 'exact' });

    if (search) {
      query = query.or(
        `email.ilike.%${search}%,display_name.ilike.%${search}%,privy_user_id.ilike.%${search}%,telegram_handle.ilike.%${search}%,twitter_username.ilike.%${search}%`,
      );
    }

    if (access === 'granted') query = query.eq('mainnet_access', true);
    else if (access === 'not_granted') query = query.eq('mainnet_access', false);

    query = query.order(sortCol, { ascending: sortAsc }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    return { entries: data ?? [], total: count ?? 0 };
  }

  async setAccess(id: string, grant: boolean) {
    const { error } = await this.supabase.mainnetWaitlist
      .update({ mainnet_access: grant })
      .eq('id', id);

    if (error) throw new Error(error.message);
    return { ok: true };
  }

  async grantAccessByEmail(email: string) {
    const normalised = email.trim().toLowerCase();

    // Verify the user is registered before granting access
    const { data: appUser, error: userError } = await this.supabase.appUsers
      .select('privy_user_id, email')
      .ilike('email', normalised)
      .maybeSingle();

    if (userError) throw new Error(userError.message);
    if (!appUser) {
      throw new NotFoundException(`No registered user found with email: ${normalised}`);
    }

    const privyUserId = appUser.privy_user_id as string;

    // Update existing waitlist entry matched by email
    const { data: updated, error: updateError } = await this.supabase.mainnetWaitlist
      .update({ mainnet_access: true })
      .ilike('email', normalised)
      .select('id');

    if (updateError) throw new Error(updateError.message);

    // No waitlist entry yet — create a minimal one with access already granted
    if (!updated || updated.length === 0) {
      const { error: insertError } = await this.supabase.mainnetWaitlist
        .insert({ privy_user_id: privyUserId, email: normalised, mainnet_access: true });

      if (insertError) throw new Error(insertError.message);
    }

    return { ok: true };
  }
}
