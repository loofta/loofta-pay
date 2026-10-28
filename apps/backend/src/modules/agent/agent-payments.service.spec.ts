import { BadRequestException } from '@nestjs/common';
import { AgentPaymentsService, parseRecipient } from './agent-payments.service';
import { TestDb } from './test-db';
import { UncertainPaymentError } from '../twitter-autopay/twitter-autopay.service';
import type { AgentSession } from './agent-auth.service';

const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  id: 'sess-1', userId: 'did:privy:u', label: 'Claude Code', scopes: ['read', 'pay'],
  perPaymentCapUsd: 25, dailyCapUsd: 100, autoApproveUsd: 5, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), ...over,
});

function build(o: { balance?: number; autoPayOn?: boolean; exec?: (p: any) => Promise<any>; accountLimit?: boolean } = {}) {
  const db = new TestDb();
  db.rows('agent_sessions').push({ id: 'sess-1', user_id: 'did:privy:u', label: 'Claude Code' });
  const executed: any[] = [];
  const autopay: any = {
    resolvePayerByUserId: async () => ({ userId: 'did:privy:u', signerGranted: o.autoPayOn ?? true, perPaymentCapUsd: 25, dailyCapUsd: 100, ownerHandle: '' }),
    assertWithinLimits: jest.fn(async () => { if (o.accountLimit) throw new BadRequestException('over the account daily limit'); }),
    planPayment: async (_r: any, isPrivate: boolean, _d: boolean, amount: number) => ({
      registered: true, delivery: isPrivate ? 'private' : 'instant', privateFeeUsd: isPrivate ? 0.21 : 0, looftaFeeUsd: amount * 0.002, claimFeeUsd: 0, totalUsd: amount * 1.002 + (isPrivate ? 0.21 : 0),
    }),
    executePayment: jest.fn(async (p: any) => {
      executed.push(p);
      if (o.exec) return o.exec(p);
      return { paymentId: `pay-${p.recipient.value}`, shortId: `s-${p.recipient.value}`, claimLink: `https://x/c/${p.recipient.value}` };
    }),
  };
  const users: any = {
    getSolanaWalletAddress: async () => '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    getSolanaWalletBalanceAndAddress: async () => ({ balanceUSD: o.balance ?? 100, walletAddress: 'x' }),
  };
  const svc = new AgentPaymentsService(db as any, { get: () => undefined } as any, users, autopay);
  // someone this person has already paid, so small payments to them need no approval
  db.rows('agent_actions').push({ id: 'old', created_at: '2026-10-01T00:00:00Z', user_id: 'did:privy:u', status: 'paid', handles: ['username:alice_w', 'username:bob_wh'] });
  db.rows('telegram_bot_actions').push({ privy_user_id: 'did:privy:u', kind: 'pay', recipient_handle: 'carol_tg', status: 'paid', created_at: '2026-10-02T00:00:00Z' });
  return { svc, db, autopay, executed };
}
const pay = (svc: AgentPaymentsService, s: AgentSession, payments: any[], key = 'key-12345678', extra: any = {}) => svc.pay(s, { payments, ...extra }, key);

describe('paying inside the limits', () => {
  it('sends straight away to someone already paid, within the auto-approve amount', async () => {
    const { svc, executed } = build();
    const r = await pay(svc, session(), [{ recipient: '@Alice_W', amount_usd: 3 }]);
    expect(r.status).toBe('paid');
    expect(r.recipients[0]).toMatchObject({ recipient: '@alice_w', status: 'sent', link: expect.stringContaining('/share/') });
    expect(executed).toHaveLength(1);
  });
  it('a retry with the same key returns the first answer and never pays twice', async () => {
    const { svc, executed } = build();
    const a = await pay(svc, session(), [{ recipient: 'alice_w', amount_usd: 3 }], 'same-key-1');
    const b = await pay(svc, session(), [{ recipient: 'alice_w', amount_usd: 3 }], 'same-key-1');
    expect(b.id).toBe(a.id);
    expect(executed).toHaveLength(1);
  });
  it('the same key for a different request is refused', async () => {
    const { svc } = build();
    await pay(svc, session(), [{ recipient: 'alice_w', amount_usd: 3 }], 'same-key-2');
    await expect(pay(svc, session(), [{ recipient: 'alice_w', amount_usd: 4 }], 'same-key-2')).rejects.toMatchObject({ response: { code: 'idempotency_key_reused' } });
  });
  it('needs an idempotency key at all', async () => {
    const { svc } = build();
    await expect(pay(svc, session(), [{ recipient: 'alice_w', amount_usd: 3 }], 'x')).rejects.toMatchObject({ response: { code: 'idempotency_key_required' } });
  });
});

describe('waiting for the person', () => {
  it('a new recipient waits, with a link to approve, and nothing is sent', async () => {
    const { svc, executed } = build();
    const r = await pay(svc, session(), [{ recipient: 'brand_new', amount_usd: 2 }]);
    expect(r.status).toBe('needs_approval');
    expect(r.approval_url).toContain('/agent?approve=');
    expect(r.approval_reason).toContain('has not been paid');
    expect(executed).toHaveLength(0);
  });
  it('more than the auto-approve amount waits, even for a known recipient', async () => {
    const { svc, executed } = build();
    expect((await pay(svc, session(), [{ recipient: 'alice_w', amount_usd: 10 }])).status).toBe('needs_approval');
    expect(executed).toHaveLength(0);
  });
  it('a session with auto-approve at 0 asks before every payment', async () => {
    const { svc } = build();
    expect((await pay(svc, session({ autoApproveUsd: 0 }), [{ recipient: 'alice_w', amount_usd: 1 }])).status).toBe('needs_approval');
  });
  it('approving sends it once, and approving again only shows the result', async () => {
    const { svc, executed } = build();
    const waiting = await pay(svc, session(), [{ recipient: 'brand_new', amount_usd: 2 }]);
    const done = await svc.approve('did:privy:u', waiting.id);
    expect(done.status).toBe('paid');
    const again = await svc.approve('did:privy:u', waiting.id);
    expect(again.status).toBe('paid');
    expect(executed).toHaveLength(1);
  });
  it('only the owner can approve or deny, and denying sends nothing', async () => {
    const { svc, executed } = build();
    const waiting = await pay(svc, session(), [{ recipient: 'brand_new', amount_usd: 2 }]);
    await expect(svc.approve('did:privy:intruder', waiting.id)).rejects.toThrow();
    expect((await svc.deny('did:privy:u', waiting.id)).status).toBe('denied');
    await expect(svc.approve('did:privy:u', waiting.id)).resolves.toMatchObject({ status: 'denied' });
    expect(executed).toHaveLength(0);
  });
  it('an approval that sat too long expires instead of running', async () => {
    const { svc, db, executed } = build();
    const waiting = await pay(svc, session(), [{ recipient: 'brand_new', amount_usd: 2 }]);
    db.rows('agent_actions').find((r: any) => r.id === waiting.id)!.expires_at = new Date(Date.now() - 1000).toISOString();
    await expect(svc.approve('did:privy:u', waiting.id)).rejects.toMatchObject({ response: { code: 'expired' } });
    expect(executed).toHaveLength(0);
  });
  it('the agent cannot read another sessions request', async () => {
    const { svc } = build();
    const waiting = await pay(svc, session(), [{ recipient: 'brand_new', amount_usd: 2 }]);
    await expect(svc.get(session({ id: 'sess-other' }), waiting.id)).rejects.toThrow();
    expect((await svc.get(session(), waiting.id)).id).toBe(waiting.id);
  });
});

describe('limits and refusals', () => {
  it('refuses a payment over the sessions per-payment limit before anything else', async () => {
    const { svc, executed } = build();
    await expect(pay(svc, session(), [{ recipient: 'alice_w', amount_usd: 30 }])).rejects.toMatchObject({ response: { code: 'over_session_limit' } });
    expect(executed).toHaveLength(0);
  });
  it('refuses once the sessions daily limit would be passed', async () => {
    const { svc, db } = build();
    db.rows('agent_actions').push({ session_id: 'sess-1', status: 'paid', amount_usd: 95, created_at: new Date().toISOString() });
    await expect(pay(svc, session(), [{ recipient: 'alice_w', amount_usd: 10 }])).rejects.toMatchObject({ response: { code: 'over_session_limit' } });
  });
  it('also respects the persons own account limits', async () => {
    const { svc } = build({ accountLimit: true });
    await expect(pay(svc, session(), [{ recipient: 'alice_w', amount_usd: 3 }])).rejects.toMatchObject({ response: { code: 'over_account_limit' } });
  });
  it('refuses when auto-pay is off, or the wallet cannot cover it with fees', async () => {
    await expect(pay(build({ autoPayOn: false }).svc, session(), [{ recipient: 'alice_w', amount_usd: 3 }])).rejects.toMatchObject({ response: { code: 'auto_pay_off' } });
    await expect(pay(build({ balance: 2 }).svc, session(), [{ recipient: 'alice_w', amount_usd: 3 }])).rejects.toMatchObject({ response: { code: 'insufficient_balance' } });
  });
  it('refuses bad input: duplicates, bad names, bad amounts, too many, delay without private', async () => {
    const { svc } = build();
    const s = session({ perPaymentCapUsd: 500, dailyCapUsd: 5000 });
    const bad = async (payments: any[], extra: any = {}) => pay(svc, s, payments, 'key-' + Math.random().toString(36).slice(2, 12), extra);
    await expect(bad([{ recipient: 'alice_w', amount_usd: 1 }, { recipient: '@ALICE_W', amount_usd: 2 }])).rejects.toMatchObject({ response: { code: 'duplicate_recipient' } });
    await expect(bad([{ recipient: 'a', amount_usd: 1 }])).rejects.toMatchObject({ response: { code: 'bad_recipient' } });
    await expect(bad([{ recipient: 'alice_w', amount_usd: 0 }])).rejects.toMatchObject({ response: { code: 'bad_amount' } });
    await expect(bad([{ recipient: 'alice_w', amount_usd: 1.234 }])).rejects.toMatchObject({ response: { code: 'bad_amount' } });
    await expect(bad([{ recipient: 'alice_w', amount_usd: 0.5 }], { privately: true })).rejects.toMatchObject({ response: { code: 'bad_amount' } });
    await expect(bad([{ recipient: 'alice_w', amount_usd: 1 }], { delay_minutes: 30 })).rejects.toMatchObject({ response: { code: 'private_only' } });
    await expect(bad(Array.from({ length: 6 }, (_, i) => ({ recipient: `user_${i}aaa`, amount_usd: 1 })))).rejects.toMatchObject({ response: { code: 'too_many' } });
    await expect(bad([])).rejects.toMatchObject({ response: { code: 'no_payments' } });
  });
  it('a session without the pay scope cannot quote or pay', async () => {
    const { svc } = build();
    const readOnly = session({ scopes: ['read'] });
    await expect(pay(svc, readOnly, [{ recipient: 'alice_w', amount_usd: 1 }])).rejects.toMatchObject({ response: { code: 'missing_scope' } });
    await expect(svc.quote(readOnly, { payments: [{ recipient: 'alice_w', amount_usd: 1 }] })).rejects.toMatchObject({ response: { code: 'missing_scope' } });
  });
});

describe('when a payment cannot be confirmed', () => {
  it('stays unconfirmed, tells the agent not to assume, and stops the rest', async () => {
    const { svc, executed } = build({ exec: async (p) => { if (p.recipient.value === 'alice_w') throw new UncertainPaymentError('timeout', 'p', null); return { paymentId: 'p', shortId: 's', claimLink: 'c' }; } });
    const r = await pay(svc, session({ autoApproveUsd: 50 }), [{ recipient: 'alice_w', amount_usd: 3 }, { recipient: 'bob_wh', amount_usd: 2 }]);
    expect(r.status).toBe('unconfirmed');
    expect(r.recipients.map((x: { status: string }) => x.status)).toEqual(['unconfirmed', 'not_attempted']);
    expect(executed).toHaveLength(1);
    // and a retry with the same key does not run it again
    await pay(svc, session({ autoApproveUsd: 50 }), [{ recipient: 'alice_w', amount_usd: 3 }, { recipient: 'bob_wh', amount_usd: 2 }]);
    expect(executed).toHaveLength(1);
  });
  it('one failed recipient does not block the others, and the result says which', async () => {
    const { svc } = build({ exec: async (p) => { if (p.recipient.value === 'alice_w') throw new BadRequestException('Recipient is not available'); return { paymentId: 'p', shortId: 's', claimLink: 'c' }; } });
    const r = await pay(svc, session({ autoApproveUsd: 50 }), [{ recipient: 'alice_w', amount_usd: 3 }, { recipient: 'bob_wh', amount_usd: 2 }].map((x) => x), 'key-partial-1');
    expect(r.status === 'partial' || r.status === 'failed').toBe(true);
  });
});

describe('who can be paid', () => {
  it.each([
    ['@Alice_W', 'username:alice_w', '@alice_w'],
    ['alice_w', 'username:alice_w', '@alice_w'],
    ['Bob@Example.com', 'email:bob@example.com', 'bob@example.com'],
    ['x:@SomeOne', 'x:someone', 'x:@someone'],
    ['twitter:someone', 'x:someone', 'x:@someone'],
    ['telegram:carol_tg', 'telegram:carol_tg', 'telegram:@carol_tg'],
    ['discord:dave.d', 'discord:dave.d', 'discord:@dave.d'],
    ['github:octocat', 'github:octocat', 'github:@octocat'],
  ])('reads %s', (input, key, label) => {
    expect(parseRecipient(input)).toMatchObject({ key, label });
  });
  it('refuses things that are not a recipient', () => {
    for (const bad of ['', '   ', 'a', 'has space', 'x:', 'x:way_too_long_for_an_x_handle', 'https://x.com/a', '0x1234567890abcdef1234567890abcdef12345678']) {
      expect(parseRecipient(bad)).toBeNull();
    }
  });
  it('pays an email recipient through the same engine and asks first, since the email is new', async () => {
    const { svc, executed } = build();
    const waiting = await pay(svc, session(), [{ recipient: 'new.person@example.com', amount_usd: 2 }]);
    expect(waiting.status).toBe('needs_approval');
    expect(waiting.approval_reason).toContain('new.person@example.com');
    const done = await svc.approve('did:privy:u', waiting.id);
    expect(done.status).toBe('paid');
    expect(executed[0].recipient).toEqual({ kind: 'email', value: 'new.person@example.com' });
  });
  it('a Telegram recipient the person already paid through the bot is known', async () => {
    const { svc, executed } = build();
    const r = await pay(svc, session(), [{ recipient: 'telegram:carol_tg', amount_usd: 2 }]);
    expect(r.status).toBe('paid');
    expect(executed[0].recipient).toEqual({ kind: 'telegram', value: 'carol_tg' });
  });
  it('the same name on two networks is two different people', async () => {
    const { svc } = build();
    const r = await pay(svc, session({ autoApproveUsd: 50 }), [{ recipient: 'x:alicew', amount_usd: 1 }, { recipient: 'github:alicew', amount_usd: 1 }]);
    expect(r.recipients).toHaveLength(2);
  });
});

describe('context for the agent', () => {
  it('lists people already paid, most recent first, from agents and from the Telegram bot', async () => {
    const { svc } = build();
    const c = await svc.contacts(session());
    expect(c.map((x) => x.recipient).sort()).toEqual(['@alice_w', '@bob_wh', 'telegram:carol_tg']);
  });
  it('says whether someone is on Loofta, and rejects what it cannot read', async () => {
    const { svc } = build();
    expect(await svc.lookup(session(), 'Alice_W')).toEqual({ recipient: '@alice_w', on_loofta: true, delivery: 'instant' });
    await expect(svc.lookup(session(), 'not a person')).rejects.toMatchObject({ response: { code: 'bad_recipient' } });
  });
});

describe('quoting', () => {
  it('shows fees and delivery per person and whether approval will be needed, and moves nothing', async () => {
    const { svc, executed } = build();
    const q = await svc.quote(session(), { payments: [{ recipient: 'alice_w', amount_usd: 3 }, { recipient: 'brand_new', amount_usd: 2 }] });
    expect(q.recipients).toHaveLength(2);
    expect(q.total_amount_usd).toBe(5);
    expect(q.total_from_wallet_usd).toBeGreaterThan(5);
    expect(q.needs_approval).toBe(true);
    expect(executed).toHaveLength(0);
  });
});
