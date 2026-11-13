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
  /** The chosen feed name, without any prefix. */
  handle: string | null;
  avatar: PublicAvatar;
  showPnl: boolean;
  hideName: boolean;
  shareActivity: boolean;
  options: { telegram: string | null; twitter: string | null; telegramName: string | null };
}

const ADJECTIVES = ['swift', 'lucky', 'neon', 'cosmic', 'sneaky', 'bold', 'golden', 'frosty', 'wild', 'zen', 'turbo', 'pixel', 'mellow', 'crimson', 'sunny', 'shadow'];
const ANIMALS = ['otter', 'falcon', 'panda', 'tiger', 'koala', 'lynx', 'gecko', 'raven', 'shark', 'fox', 'whale', 'cobra', 'moose', 'badger', 'orca', 'yak'];
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
/** A fun name like "swiftotter42". Never built from a Telegram name, an X handle or an email. */
const randomHandle = () => `${pick(ADJECTIVES)}${pick(ANIMALS)}${Math.floor(10 + Math.random() * 90)}`;
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = /^(admin|loofta|support|staff|mod|official|team|system)/;
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

  /** What shows next to a post: the name the person chose, or a short anonymous one if they have none yet. */
  async displayName(userId: string): Promise<string> {
    const prof = await this.row(userId);
    if (prof?.hide_name || !prof?.handle) return anon(userId);
    return prof.handle;
  }

  private async row(userId: string) {
    const { data } = await this.db().from('mini_profiles').select('*').eq('privy_user_id', userId).maybeSingle();
    return data as { avatar_kind: 'telegram' | 'twitter' | 'color'; avatar_url: string | null; avatar_color: string | null; show_pnl: boolean; hide_name: boolean; share_activity: boolean; handle: string | null } | null;
  }

  /** First time: give the person a colour picture and a fun name without asking. Nothing is taken from Telegram, X or email. */
  async ensureProfile(userId: string): Promise<void> {
    try {
      const existing = await this.row(userId);
      if (existing?.handle) return;
      if (existing) {
        await this.assignHandle(userId);
        return;
      }
      // A colour to start with. A Telegram or X photo can identify someone, so it is only used when they pick it.
      const base = { privy_user_id: userId, avatar_kind: 'color', avatar_color: colorFor(userId) };
      await this.db().from('mini_profiles').upsert(base, { onConflict: 'privy_user_id', ignoreDuplicates: true });
      await this.assignHandle(userId);
    } catch (e) {
      this.logger.debug(`ensureProfile failed: ${(e as Error).message}`);
    }
  }

  /** Picks a free fun name. The unique index settles races, so a clash just tries another. */
  private async assignHandle(userId: string): Promise<string | null> {
    for (let i = 0; i < 8; i++) {
      const h = randomHandle();
      const { error } = await this.db().from('mini_profiles').update({ handle: h, updated_at: new Date().toISOString() }).eq('privy_user_id', userId);
      if (!error) return h;
    }
    return null;
  }

  async getProfile(userId: string): Promise<MiniProfile> {
    await this.ensureProfile(userId);
    const [row, s, name] = await Promise.all([this.row(userId), this.social(userId), this.displayName(userId)]);
    return {
      name,
      handle: row?.handle ?? null,
      avatar: this.toAvatar(userId, row),
      showPnl: row?.show_pnl ?? true,
      hideName: row?.hide_name ?? false,
      shareActivity: row?.share_activity ?? true,
      options: { telegram: s.telegramPhoto, twitter: s.twitterPhoto, telegramName: s.telegramName },
    };
  }

  toAvatar(userId: string, row: { avatar_kind: string; avatar_url: string | null; avatar_color: string | null } | null | undefined): PublicAvatar {
    const color = (AVATAR_COLORS as readonly string[]).includes(row?.avatar_color ?? '') ? (row!.avatar_color as AvatarColor) : colorFor(userId);
    if (row && row.avatar_kind !== 'color' && row.avatar_url) return { kind: 'image', url: row.avatar_url, color };
    return { kind: 'color', url: null, color };
  }

  async setProfile(userId: string, b: { avatar?: string; color?: string; showPnl?: boolean; hideName?: boolean; shareActivity?: boolean; handle?: string; shuffleHandle?: boolean; useTelegramName?: boolean }): Promise<MiniProfile> {
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
    if (typeof b.shareActivity === 'boolean') patch.share_activity = b.shareActivity;
    if (b.shuffleHandle) {
      await this.assignHandle(userId);
    } else if (b.handle !== undefined || b.useTelegramName) {
      let h = b.handle ?? '';
      // Telegram is only used when the person asks for it.
      if (b.useTelegramName) h = (await this.social(userId)).telegramName ?? '';
      h = h.trim().toLowerCase().replace(/^@/, '').replace(/^loo-/, '');
      if (!HANDLE_RE.test(h)) throw new BadRequestException('Use 3 to 20 letters, numbers or underscores.');
      if (RESERVED.test(h)) throw new BadRequestException('That name is reserved.');
      patch.handle = h;
    }
    const { error } = await this.db().from('mini_profiles').update(patch).eq('privy_user_id', userId);
    if (error) {
      if (/duplicate|unique/i.test(error.message)) throw new BadRequestException('That name is taken. Try another.');
      throw new BadRequestException('Could not save. Try again.');
    }
    return this.getProfile(userId);
  }

  /** Profiles for many people at once, for the feed. Keyed by Privy id, never sent to the app. */
  async many(ids: string[]) {
    const out = new Map<string, { avatar: PublicAvatar; showPnl: boolean; hideName: boolean; shareActivity: boolean; handle: string | null }>();
    if (!ids.length) return out;
    const { data } = await this.db().from('mini_profiles').select('*').in('privy_user_id', ids);
    const byId = new Map((data ?? []).map((r: any) => [r.privy_user_id as string, r]));
    for (const id of ids) {
      const r = byId.get(id);
      out.set(id, { avatar: this.toAvatar(id, r), showPnl: r?.show_pnl ?? true, hideName: r?.hide_name ?? false, shareActivity: r?.share_activity ?? true, handle: r?.handle ?? null });
    }
    return out;
  }
}

export { anon as anonName };
