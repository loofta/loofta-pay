import { TelegramBotService } from './telegram-bot.service';

function build(decide?: jest.Mock) {
  const config: any = { get: () => undefined };
  const notifier: any = { decideAgentRequest: decide ?? jest.fn(async () => ({ status: 'paid', summary: 'Sent: x:lisabeyy $1.' })) };
  const svc: any = new TelegramBotService({} as any, config, {} as any, {} as any, {} as any, {} as any, notifier);
  const api = { answerCallback: jest.fn(), editMessage: jest.fn(), sendMessage: jest.fn() };
  svc.api = api;
  svc.resolveLinkedUser = jest.fn(async (id: number) => (id === 7 ? 'did:privy:u' : null));
  return { svc, api, notifier };
}
const cb = (data: string, fromId = 7) => ({ id: 'cb1', data, from: { id: fromId }, message: { chat: { id: 100, type: 'private' }, message_id: 55 } }) as any;
const msg = (text: string, fromId = 7) => ({ text, from: { id: fromId, is_bot: false }, chat: { id: 100, type: 'private' }, message_id: 60 }) as any;

describe('approving an agent payment in the bot', () => {
  it('tapping Approve sends nothing yet and asks for CONFIRM', async () => {
    const { svc, api, notifier } = build();
    await svc.onAgentApprovalCallback(cb('ap:y:act-1'), 'y', 'act-1');
    expect(notifier.decideAgentRequest).not.toHaveBeenCalled();
    expect(api.editMessage.mock.calls[0][2]).toContain('CONFIRM');
  });

  it('typing CONFIRM then sends it', async () => {
    const { svc, notifier } = build();
    await svc.onAgentApprovalCallback(cb('ap:y:act-1'), 'y', 'act-1');
    svc.rememberUser = jest.fn();
    svc.touchNudge = jest.fn();
    await svc.onMessage(msg('CONFIRM'));
    expect(notifier.decideAgentRequest).toHaveBeenCalledWith('did:privy:u', 'act-1', true);
  });

  it.each(['confirm', 'yes', 'ok', 'CONFIRM please'])('"%s" does not send it', async (word) => {
    const { svc, notifier, api } = build();
    await svc.onAgentApprovalCallback(cb('ap:y:act-1'), 'y', 'act-1');
    svc.rememberUser = jest.fn();
    svc.touchNudge = jest.fn();
    await svc.onMessage(msg(word));
    expect(notifier.decideAgentRequest).not.toHaveBeenCalled();
    expect(api.sendMessage.mock.calls[0][1]).toContain('nothing was sent');
  });

  it('the word counts once: a second CONFIRM does not send again', async () => {
    const { svc, notifier } = build();
    await svc.onAgentApprovalCallback(cb('ap:y:act-1'), 'y', 'act-1');
    svc.rememberUser = jest.fn();
    svc.touchNudge = jest.fn();
    await svc.onMessage(msg('CONFIRM'));
    await svc.onMessage(msg('CONFIRM'));
    expect(notifier.decideAgentRequest).toHaveBeenCalledTimes(1);
  });

  it('CONFIRM after the 10 minutes is up sends nothing', async () => {
    const { svc, notifier } = build();
    await svc.onAgentApprovalCallback(cb('ap:y:act-1'), 'y', 'act-1');
    for (const v of svc.agentConfirms.values()) v.until = Date.now() - 1;
    svc.rememberUser = jest.fn();
    svc.touchNudge = jest.fn();
    await svc.onMessage(msg('CONFIRM'));
    expect(notifier.decideAgentRequest).not.toHaveBeenCalled();
  });

  it('Deny needs no confirmation', async () => {
    const { svc, notifier } = build(jest.fn(async () => ({ status: 'denied', summary: 'Denied.' })));
    await svc.onAgentApprovalCallback(cb('ap:n:act-1'), 'n', 'act-1');
    expect(notifier.decideAgentRequest).toHaveBeenCalledWith('did:privy:u', 'act-1', false);
  });

  it('a Telegram account that is not linked cannot start an approval', async () => {
    const { svc, notifier } = build();
    await svc.onAgentApprovalCallback(cb('ap:y:act-1', 999), 'y', 'act-1');
    expect(svc.agentConfirms.size).toBe(0);
    expect(notifier.decideAgentRequest).not.toHaveBeenCalled();
  });

  it('a group chat button press does nothing', async () => {
    const { svc, notifier } = build();
    const c = cb('ap:y:act-1');
    c.message.chat.type = 'group';
    await svc.onAgentApprovalCallback(c, 'y', 'act-1');
    expect(svc.agentConfirms.size).toBe(0);
    expect(notifier.decideAgentRequest).not.toHaveBeenCalled();
  });
});

describe('the confirm card for someone who only accepts private payments', () => {
  const plan = (o: any) => ({ registered: true, delivery: 'instant', privateFeeUsd: 0, looftaFeeUsd: 0.01, claimFeeUsd: 0, totalUsd: 5.01, ...o });
  const card = (plans: any[], items: any[]) => (build().svc as any).renderCard('b1', items, { isPrivate: false, split: null, delayMs: null }, plans, 10).text as string;

  it('says it is private only, with the private fee and the delay', () => {
    const text = card([plan({ delivery: 'private', privateFeeUsd: 0.21, totalUsd: 5.22 })], [{ recipient_handle: 'lisabeyy', amount_usd: 5 }]);
    expect(text).toContain('only accepts private payments');
    expect(text).toContain('short delay');
    expect(text).toContain('Private payment fee');
    expect(text).not.toContain('arrives straight in their wallet');
  });
  it('an ordinary registered recipient is unchanged', () => {
    const text = card([plan({})], [{ recipient_handle: 'alice_w', amount_usd: 5 }]);
    expect(text).toContain('arrives straight in their wallet');
    expect(text).not.toContain('Private payment fee');
  });
  it('a batch marks only the private-only person', () => {
    const text = card([plan({ delivery: 'private', privateFeeUsd: 0.21, totalUsd: 5.22 }), plan({})], [{ recipient_handle: 'lisabeyy', amount_usd: 5 }, { recipient_handle: 'alice_w', amount_usd: 5 }]);
    expect(text).toMatch(/1\. @lisabeyy.*private only/);
    expect(text).toMatch(/2\. @alice_w.*arrives in their wallet/);
  });
});
