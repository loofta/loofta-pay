import { TelegramBotService } from './telegram-bot.service';
import { parseSendCommand } from './telegram-parser';
import { TestDb } from '../agent/test-db';

function build(o: { dm?: boolean } = {}) {
  const db = new TestDb();
  if (o.dm !== false) db.rows('telegram_bot_users').push({ telegram_user_id: 7, chat_id: 200, username: 'alice' });
  const config: any = { get: () => undefined };
  const users: any = { getSolanaWalletBalanceAndAddress: async () => ({ balanceUSD: 50 }) };
  const autopay: any = {
    resolvePayerByUserId: async () => ({ signerGranted: true, perPaymentCapUsd: 100, dailyCapUsd: 100 }),
    assertWithinLimits: async () => undefined,
    planTelegramPayment: async () => ({ totalUsd: 5.01, looftaFeeUsd: 0.01, claimFeeUsd: 0, privateFeeUsd: 0, delivery: 'instant' }),
    executeTelegramAutoPay: async () => ({ paymentId: 'p1', claimLink: 'https://x/c/1', shortId: 's1' }),
    unclaimedPaymentIds: async () => new Set(),
  };
  const svc: any = new TelegramBotService(db as any, config, users, autopay, {} as any, {} as any, {} as any);
  const api = { answerCallback: jest.fn(), editMessage: jest.fn(), sendMessage: jest.fn(async (..._a: any[]) => ({ message_id: 1 })), deleteMessage: jest.fn() };
  svc.api = api;
  svc.resolveLinkedUser = jest.fn(async () => 'did:privy:u');
  return { svc, api, db };
}
const group = { message_id: 60, chat: { id: -500, type: 'supergroup' }, from: { id: 7, username: 'alice' } } as any;
const send = (svc: any, text = 'pay $5 to @bobby') => svc.onSend(group, group.from, parseSendCommand(text, 'looftapay_bot'));

describe('paying from a group', () => {
  it('shows fees and balance only in the private chat, the group just hears it was sent there', async () => {
    const { svc, api, db } = build();
    await send(svc);
    const to = (chat: number) => api.sendMessage.mock.calls.filter((c: any[]) => c[0] === chat).map((c: any[]) => String(c[1]));
    expect(to(200).join('\n')).toMatch(/Fees/);
    expect(to(200).join('\n')).toMatch(/Your balance/);
    expect(to(-500)).toEqual(['I sent you the details in private.']);
    const row = db.rows('telegram_bot_actions')[0];
    expect(row).toMatchObject({ chat_id: 200, source_chat_id: -500, source_message_id: 60 });
  });

  it('asks the person to open a chat first when the bot cannot message them, and shows nothing personal', async () => {
    const { svc, api, db } = build({ dm: false });
    await send(svc);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    const [chat, text] = api.sendMessage.mock.calls[0] as any[];
    expect(chat).toBe(-500);
    expect(text).not.toMatch(/Fees|balance \$|Total/);
    expect(db.rows('telegram_bot_actions')).toHaveLength(0);
  });

  it('after Confirm, the group gets only who was paid and how much', async () => {
    const { svc, api, db } = build();
    await send(svc);
    // The real table fills these in by default.
    for (const r of db.rows('telegram_bot_actions')) Object.assign(r, { kind: 'pay', status: 'pending', created_at: new Date().toISOString() });
    const batch = db.rows('telegram_bot_actions')[0].batch_id;
    api.sendMessage.mockClear();
    await svc.onCallback({ id: 'c', data: `ok:${batch}`, from: { id: 7 }, message: { chat: { id: 200, type: 'private' }, message_id: 9 } });
    const inGroup = api.sendMessage.mock.calls.filter((c: any[]) => c[0] === -500);
    expect(inGroup).toHaveLength(1);
    expect(String(inGroup[0][1])).toBe('Sent <b>$5.00</b> to <b>@bobby</b>.');
    expect(String(inGroup[0][1])).not.toMatch(/balance|fee/i);
    expect(inGroup[0][2]).toMatchObject({ replyTo: 60 });
  });
});
