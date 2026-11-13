import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { RedisService } from '../../redis/redis.service';

const PAY_BASE = (process.env.PAY_BASE_URL || 'https://pay.loofta.com').replace(/\/$/, '');
const RECEIVED_VISIBLE = ['SUCCESS', 'PRIVATE_TRANSFER_PENDING'];

export interface PayProfile {
  username: string | null;
  link: string | null;
}

export interface PayHistoryItem {
  id: string;
  kind: 'sent' | 'received' | 'deposit';
  amount: number;
  /** Who it went to or came from. A handle, an email or a short label. */
  who: string;
  status: string;
  at: string;
}

/**
 * Pay by username in the Telegram mini app: your personal link, picking a username, and your history.
 * Sending itself uses the main send-payment endpoints (/users/pay-target, /send-payment/multi-build and
 * multi-confirm), which the app calls directly.
 */
@Injectable()
export class MiniPayService {
  private readonly logger = new Logger(MiniPayService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
  ) {}

  private db() {
    return this.supabase.getClient();
  }

  async profile(userId: string): Promise<PayProfile> {
    const { data } = await this.db().from('app_users').select('username, loo_username').eq('privy_user_id', userId).maybeSingle();
    const handle = (data?.username || data?.loo_username || '').replace(/^@/, '');
    return { username: handle || null, link: handle ? `${PAY_BASE}/@${handle}` : null };
  }

  /**
   * First username for someone who has none. Always a loo- name: names without the prefix are reserved for
   * people who have linked the matching X account, which the mini app cannot verify. Changing an existing
   * username is not offered here.
   */
  async setUsername(userId: string, raw: unknown): Promise<PayProfile> {
    const name = String(raw ?? '').trim().toLowerCase().replace(/^@/, '').replace(/^loo-/, '');
    if (!/^[a-z0-9_]{1,16}$/.test(name)) throw new BadRequestException('Use 1 to 16 letters, numbers or underscores.');
    if (name.startsWith('skr-')) throw new BadRequestException('That name is reserved.');
    const candidate = `loo-${name}`;

    const { data: mine } = await this.db().from('app_users').select('id, username, loo_username').eq('privy_user_id', userId).maybeSingle();
    if (!mine) throw new BadRequestException('Your account is not ready yet. Try again in a moment.');
    if (mine.username) throw new ConflictException('You already have a username.');

    // Two queries, because a hyphen inside a PostgREST .or() value breaks the filter.
    const [byUsername, byLoo] = await Promise.all([
      this.db().from('app_users').select('privy_user_id').eq('username', candidate).neq('privy_user_id', userId).limit(1),
      this.db().from('app_users').select('privy_user_id').eq('loo_username', candidate).neq('privy_user_id', userId).limit(1),
    ]);
    if ((byUsername.data?.length ?? 0) > 0 || (byLoo.data?.length ?? 0) > 0) throw new ConflictException('That username is taken.');

    const { error } = await this.db()
      .from('app_users')
      .update({ username: candidate, ...(mine.loo_username ? {} : { loo_username: candidate }) })
      .eq('privy_user_id', userId);
    if (error) {
      if (error.code === '23505') throw new ConflictException('That username is taken.');
      this.logger.warn(`setUsername failed: ${error.message}`);
      throw new BadRequestException('Could not save the username. Try again.');
    }
    // The web app caches the profile. Clear it so every device sees the new name.
    await this.redis.del(`user:prefs:${userId}`).catch(() => {});
    return this.profile(userId);
  }

  /** Sent, received and deposits, newest first. */
  async history(userId: string): Promise<PayHistoryItem[]> {
    const select = 'id, amount, status, created_at, recipient_username, recipient_email, sender_user_id';
    const [sent, received, deposits] = await Promise.all([
      this.db().from('payments').select(select).eq('sender_user_id', userId).eq('is_devnet', false).order('created_at', { ascending: false }).limit(40),
      this.db().from('payments').select(select).eq('recipient_user_id', userId).in('status', RECEIVED_VISIBLE).eq('is_devnet', false).order('created_at', { ascending: false }).limit(40),
      this.db().from('user_deposits').select('id, type, status, amount_usdc, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    ]);

    // Names for the people who sent to you.
    const senderIds = [...new Set((received.data ?? []).map((r) => r.sender_user_id as string | null).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (senderIds.length > 0) {
      const { data } = await this.db().from('app_users').select('privy_user_id, username, loo_username').in('privy_user_id', senderIds);
      for (const u of data ?? []) names.set(u.privy_user_id as string, `@${String(u.username || u.loo_username || '').replace(/^@/, '')}`);
    }

    const items: PayHistoryItem[] = [
      ...(sent.data ?? []).map((r) => ({
        id: String(r.id),
        kind: 'sent' as const,
        amount: Number(r.amount),
        who: r.recipient_username ? `@${String(r.recipient_username).replace(/^@/, '')}` : String(r.recipient_email ?? 'Someone'),
        status: String(r.status),
        at: String(r.created_at),
      })),
      ...(received.data ?? []).map((r) => ({
        id: String(r.id),
        kind: 'received' as const,
        amount: Number(r.amount),
        who: names.get(String(r.sender_user_id)) ?? 'Someone',
        status: String(r.status),
        at: String(r.created_at),
      })),
      ...(deposits.data ?? []).map((d) => ({
        id: String(d.id),
        kind: 'deposit' as const,
        amount: Number(d.amount_usdc ?? 0),
        who: d.type === 'card-onramp' ? 'Card' : 'Added money',
        status: String(d.status),
        at: String(d.created_at),
      })),
    ];
    return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 60);
  }
}
