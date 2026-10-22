import { TelegramBotService } from './telegram-bot.service';

/**
 * /logout and the local sign-out gate. Identity is normally resolved through Privy; when Privy
 * refuses to unlink Telegram (it is the user's only login method) the bot signs them out locally
 * instead, and the app clears that on the next visit. These pin the two directions down.
 */
function build(opts: { signedOutAt?: string | null; privyUserId?: string | null; telegramUserId?: string | null } = {}) {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const client: any = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { signed_out_at: opts.signedOutAt ?? null } }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          updates.push({ table, patch });
          return { error: null };
        },
      }),
    }),
  };
  const db: any = { getClient: () => client };
  const config: any = { get: (key: string) => (key === 'TELEGRAM_BOT_TOKEN' ? undefined : 'test') };
  const svc = new TelegramBotService(db, config, {} as any, {} as any, {} as any, {} as any);
  (svc as any).privy = {
    getUserByTelegramUserId: async () => (opts.privyUserId === null ? null : { id: opts.privyUserId ?? 'did:privy:u' }),
    getUserById: async () => ({
      linkedAccounts: opts.telegramUserId === null ? [] : [{ type: 'telegram', telegramUserId: opts.telegramUserId ?? '42' }],
    }),
  };
  return { svc, updates };
}

describe('resolveLinkedUser sign-out gate', () => {
  it('returns the Privy user when not signed out', async () => {
    const { svc } = build();
    expect(await (svc as any).resolveLinkedUser(42)).toBe('did:privy:u');
  });

  it('returns null once the bot has signed the user out locally, even if Privy still links them', async () => {
    const { svc } = build({ signedOutAt: '2026-10-18T00:00:00.000Z' });
    expect(await (svc as any).resolveLinkedUser(42)).toBeNull();
  });
});

describe('reconnect', () => {
  it('clears a local sign-out for the linked Telegram user', async () => {
    const { svc, updates } = build();
    expect(await svc.reconnect('did:privy:u')).toEqual({ ok: true, telegramLinked: true });
    expect(updates).toEqual([{ table: 'telegram_bot_users', patch: { signed_out_at: null } }]);
  });

  it('reports no Telegram link and changes nothing when there is none', async () => {
    const { svc, updates } = build({ telegramUserId: null });
    expect(await svc.reconnect('did:privy:u')).toEqual({ ok: false, telegramLinked: false });
    expect(updates).toEqual([]);
  });
});

describe('logout', () => {
  it('unlinks through Privy when it can, so no local sign-out is needed', async () => {
    const { svc, updates } = build();
    (svc as any).privyUnlinkTelegram = async () => true;
    const sent: string[] = [];
    (svc as any).api = { sendMessage: async (_chat: number, text: string) => (sent.push(text), undefined) };

    await (svc as any).logout(1, { id: 42 });

    expect(sent.join('\n')).toMatch(/logged out/i);
    expect(updates.every((u) => !('signed_out_at' in u.patch) || u.patch.signed_out_at === null)).toBe(true);
  });

  it('falls back to a local sign-out when Privy refuses (Telegram is the only login method)', async () => {
    const { svc, updates } = build();
    (svc as any).privyUnlinkTelegram = async () => false;
    const sent: string[] = [];
    (svc as any).api = { sendMessage: async (_chat: number, text: string) => (sent.push(text), undefined) };

    await (svc as any).logout(1, { id: 42 });

    const signOut = updates.find((u) => u.patch.signed_out_at);
    expect(typeof signOut?.patch.signed_out_at).toBe('string');
    expect(sent.join('\n')).toMatch(/only way to sign in/i);
  });
});
