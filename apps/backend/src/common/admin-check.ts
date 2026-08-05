import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';

/**
 * Shared admin check — env var allowlist first (fast, no DB query), then `users.role = 'admin'`.
 * Single source of truth so AdminGuard and any service that needs to gate an admin-only action
 * inline (e.g. GiveawaysService.create()'s "create as Loofta" flag) can't drift out of sync.
 */
export async function isPrivyUserAdmin(
  supabaseService: SupabaseService,
  configService: ConfigService,
  userId: string,
): Promise<boolean> {
  try {
    const adminIds = configService.get<string>('ADMIN_PRIVY_USER_IDS', '');
    const adminList = adminIds.split(',').map((id) => id.trim()).filter(Boolean);
    if (adminList.includes(userId)) return true;

    const { data, error } = await supabaseService.users
      .select('role')
      .eq('privy_user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}
