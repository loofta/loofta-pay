import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '@/modules/users/users.service';
import { cached } from '@/modules/mini-app/lib/sharedCache';

export const AVATAR_COLORS = ['orange', 'green', 'blue', 'purple', 'pink', 'gold', 'teal', 'red'] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

type Social = { telegramName: string | null; telegramPhoto: string | null; twitterName: string | null; twitterPhoto: string | null };

/** Only pictures from the platforms themselves are shown, whatever an account claims. */
const photoOk = (u: unknown): string | null => {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return null;
    return /(^|\.)(twimg\.com|t\.me|telesco\.pe|telegram\.org|cdn-telegram\.org)$/i.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
};

export interface PublicAvatar {
  kind: 'image' | 'color';
  url: string | null;
  color: AvatarColor;
}

export interface MiniProfile {
  name: string;
  avatar: PublicAvatar;
  showPnl: boolean;
  hideName: boolean;
  options: { telegram: string | null; twitter: string | null; telegramName: string | null };
}

const anon = (id: string) => `trader${id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toLowerCase()}`;
const colorFor = (id: string): AvatarColor => AVATAR_COLORS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

/**
 * Names and pictures for the feed. A Telegram login has no X account or email, so the account itself only has a
 * generated "loo-" name. The Telegram username and photo live on the linked Telegram account at Privy, so they are read from there.
 */
@Injectable()
export class MiniProfileService {
  private readonly logger = new Logger(MiniProfileService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
  ) {}

  private db() {
    return this.supabase.getClient();
  }

  private social(userId: string): Promise<Social> {
    return cached(`mini:social:${userId}`, 600, async () => {
      const empty: Social = { telegramName: null, telegramPhoto: null, twitterName: null, twitterPhoto: null };
      try {
        const u = await this.users.getPrivyUser(userId);
        const accounts = u?.linked_accounts ?? [];
        const tg = accounts.find((a: any) => ['telegram', 'telegram_oauth'].includes(a.type));
        const tw = accounts.find((a: any) => ['twitter', 'twitter_oauth', 'x'].includes(a.type));
        const clean = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_]{3,32}$/.test(v.replace(/^@/, '')) ? v.replace(/^@/, '') : null);
        return {
          telegramName: clean(tg?.username),
          telegramPhoto: photoOk(tg?.photo_url ?? tg?.photoUrl),
          twitterName: clean(tw?.username),
          twitterPhoto: photoOk(tw?.profile_picture_url ?? tw?.profilePictureUrl),
        };
      } catch (e) {
        this.logger.debug(`social lookup failed: ${(e as Error).message}`);
        return empty;
      }
    });
  }

  /** What shows next to a post: the Telegram username if there is one, else the account's own name, else a short anonymous name. */
  async displayName(userId: string): Promise<string> {
    const [prof, social] = await Promise.all([this.row(userId), this.social(userId)]);
    if (prof?.hide_name) return anon(userId);
    if (social.telegramName) return social.telegramName.slice(0, 24);
    try {
      const u = await this.users.findByPrivyId(userId);
      const n = u?.username || u?.looUsername;
      if (n) return n.replace(/^@/, '').slice(0, 24);
    } catch {
      /* fall through */
    }
    return anon(userId);
  }

  private async row(userId: string) {
    const { data } = await this.db().from('mini_profiles').select('*').eq('privy_user_id', userId).maybeSingle();
    return data as { avatar_kind: 'telegram' | 'twitter' | 'color'; avatar_url: string | null; avatar_color: string | null; show_pnl: boolean; hide_name: boolean } | null;
  }

  /** First post: give the person a picture without asking. Their Telegram photo if there is one, else a colour from their id. */
  async ensureProfile(userId: string): Promise<void> {
    try {
      if (await this.row(userId)) return;
      const s = await this.social(userId);
      await this.db().from('mini_profiles').insert(
        s.telegramPhoto
          ? { privy_user_id: userId, avatar_kind: 'telegram', avatar_url: s.telegramPhoto }
          : { privy_user_id: userId, avatar_kind: 'color', avatar_color: colorFor(userId) },
      );
    } catch (e) {
      this.logger.debug(`ensureProfile failed: ${(e as Error).message}`);
    }
  }

  async getProfile(userId: string): Promise<MiniProfile> {
    await this.ensureProfile(userId);
    const [row, s, name] = await Promise.all([this.row(userId), this.social(userId), this.displayName(userId)]);
    return {
      name,
      avatar: this.toAvatar(userId, row),
      showPnl: row?.show_pnl ?? true,
      hideName: row?.hide_name ?? false,
      options: { telegram: s.telegramPhoto, twitter: s.twitterPhoto, telegramName: s.telegramName },
    };
  }

  toAvatar(userId: string, row: { avatar_kind: string; avatar_url: string | null; avatar_color: string | null } | null | undefined): PublicAvatar {
    const color = (AVATAR_COLORS as readonly string[]).includes(row?.avatar_color ?? '') ? (row!.avatar_color as AvatarColor) : colorFor(userId);
    if (row && row.avatar_kind !== 'color' && row.avatar_url) return { kind: 'image', url: row.avatar_url, color };
    return { kind: 'color', url: null, color };
  }

  async setProfile(userId: string, b: { avatar?: string; color?: string; showPnl?: boolean; hideName?: boolean }): Promise<MiniProfile> {
    await this.ensureProfile(userId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.avatar !== undefined) {
      const s = await this.social(userId);
      if (b.avatar === 'telegram') {
        if (!s.telegramPhoto) throw new BadRequestException('No Telegram photo found on your account.');
        Object.assign(patch, { avatar_kind: 'telegram', avatar_url: s.telegramPhoto });
      } else if (b.avatar === 'twitter') {
        if (!s.twitterPhoto) throw new BadRequestException('Connect your X account first to use its photo.');
        Object.assign(patch, { avatar_kind: 'twitter', avatar_url: s.twitterPhoto });
      } else if (b.avatar === 'color') {
        if (!(AVATAR_COLORS as readonly string[]).includes(b.color ?? '')) throw new BadRequestException('Pick one of the colours.');
        Object.assign(patch, { avatar_kind: 'color', avatar_url: null, avatar_color: b.color });
      } else throw new BadRequestException('Unknown picture choice.');
    }
    if (typeof b.showPnl === 'boolean') patch.show_pnl = b.showPnl;
    if (typeof b.hideName === 'boolean') patch.hide_name = b.hideName;
    await this.db().from('mini_profiles').update(patch).eq('privy_user_id', userId);
    return this.getProfile(userId);
  }

  /** Profiles for many people at once, for the feed. Keyed by Privy id, never sent to the app. */
  async many(ids: string[]) {
    const out = new Map<string, { avatar: PublicAvatar; showPnl: boolean; hideName: boolean }>();
    if (!ids.length) return out;
    const { data } = await this.db().from('mini_profiles').select('*').in('privy_user_id', ids);
    const byId = new Map((data ?? []).map((r: any) => [r.privy_user_id as string, r]));
    for (const id of ids) {
      const r = byId.get(id);
      out.set(id, { avatar: this.toAvatar(id, r), showPnl: r?.show_pnl ?? true, hideName: r?.hide_name ?? false });
    }
    return out;
  }
}

export { anon as anonName };
