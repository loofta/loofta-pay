import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { EmailService } from '../email/email.service';
import { PrivyVerificationService } from '@/auth/privy-verification.service';

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
  constructor(
    private readonly supabase: SupabaseService,
    private readonly emailService: EmailService,
    private readonly privyVerification: PrivyVerificationService,
  ) {}

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
        `email.ilike.*${search}*,display_name.ilike.*${search}*,privy_user_id.ilike.*${search}*,telegram_handle.ilike.*${search}*,twitter_username.ilike.*${search}*`,
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
    const { data: entry, error: fetchError } = await this.supabase.mainnetWaitlist
      .select('email')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);

    const { error } = await this.supabase.mainnetWaitlist
      .update({ mainnet_access: grant })
      .eq('id', id);

    if (error) throw new Error(error.message);

    if (grant && entry?.email) {
      await this.emailService.sendBetaAccessEmail(entry.email as string);
    }

    return { ok: true };
  }

  async resendBetaAccessEmail(id: string) {
    const { data: entry, error } = await this.supabase.mainnetWaitlist
      .select('email')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!entry?.email) throw new NotFoundException(`No email found for waitlist entry: ${id}`);

    await this.emailService.sendBetaAccessEmail(entry.email as string);
    return { ok: true };
  }

  async grantAccessByTwitterUsername(twitterUsername: string) {
    const handle = twitterUsername.trim().replace(/^@/, '').toLowerCase();

    const { data: updated, error: updateError } = await this.supabase.mainnetWaitlist
      .update({ mainnet_access: true })
      .ilike('twitter_username', handle)
      .select('id, email, privy_user_id');

    if (updateError) throw new Error(updateError.message);

    if (updated && updated.length > 0) {
      for (const entry of updated) {
        const email = await this.resolveEmail(entry.email as string | null, entry.privy_user_id as string | null);
        if (email && !entry.email) {
          await this.supabase.mainnetWaitlist.update({ email }).eq('id', entry.id);
        }
        if (email) {
          await this.emailService.sendBetaAccessEmail(email);
        }
      }
      return { ok: true, updated: updated.length };
    }

    // No waitlist entry — look up registered user by Loofta username and create one
    const { data: appUser, error: userError } = await this.supabase.appUsers
      .select('privy_user_id, email')
      .ilike('username', handle)
      .maybeSingle();

    if (userError) throw new Error(userError.message);
    if (!appUser) {
      throw new NotFoundException(`No waitlist entry or registered user found for: @${handle}`);
    }

    const resolvedEmail = await this.resolveEmail(
      appUser.email as string | null,
      appUser.privy_user_id as string,
    );

    const { error: insertError } = await this.supabase.mainnetWaitlist
      .insert({
        privy_user_id: appUser.privy_user_id as string,
        twitter_username: handle,
        email: resolvedEmail,
        mainnet_access: true,
      });

    if (insertError) throw new Error(insertError.message);

    if (resolvedEmail) {
      await this.emailService.sendBetaAccessEmail(resolvedEmail);
    }

    return { ok: true, updated: 1 };
  }

  private async resolveEmail(stored: string | null, privyUserId: string | null): Promise<string | null> {
    if (stored) return stored;
    if (!privyUserId) return null;
    const privyUser = await this.privyVerification.getPrivyUser(privyUserId);
    for (const account of privyUser?.linked_accounts ?? []) {
      const type = (account.type || '').toLowerCase();
      if (type === 'email' || type === 'google' || type === 'apple') {
        const addr = (account.address || account.email || '').toString().trim();
        if (addr) return addr;
      }
    }
    return null;
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

    await this.emailService.sendBetaAccessEmail(normalised);

    return { ok: true };
  }
}
