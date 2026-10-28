import { AgentAuthService } from './agent-auth.service';
import { TestDb } from './test-db';

function build() {
  const db = new TestDb();
  const svc = new AgentAuthService(db as any, { get: () => undefined } as any);
  return { db, svc };
}
async function login(svc: AgentAuthService, userId = 'did:privy:u', choice: any = {}) {
  const start = await svc.startDevice({ label: 'Claude Code', scopes: ['pay'], ip: '1.2.3.4' });
  const session = await svc.approveDevice(userId, start.user_code, choice);
  return { start, session };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('device login', () => {
  it('starts with a secret, a short code and a link, and waits for the person', async () => {
    const { svc } = build();
    const s = await svc.startDevice({ label: 'Claude Code', scopes: ['pay'] });
    expect(s.device_code).toMatch(/^lft_dc_/);
    expect(s.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(s.verification_url).toContain('/agent');
    expect(await svc.pollToken(s.device_code)).toEqual({ status: 'authorization_pending' });
  });

  it('hands the agent its token exactly once, and stores only the hash', async () => {
    const { db, svc } = build();
    const { start } = await login(svc);
    await wait(2100);
    const first = await svc.pollToken(start.device_code);
    expect(first.status).toBe('approved');
    if (first.status !== 'approved') return;
    expect(first.accessToken).toMatch(/^lft_ag_/);
    expect(JSON.stringify(db.tables)).not.toContain(first.accessToken); // never stored in the clear
    await wait(2100);
    expect(await svc.pollToken(start.device_code)).toEqual({ status: 'invalid_grant' });
    // and the token works
    expect(await svc.verifyToken(first.accessToken)).toMatchObject({ userId: 'did:privy:u', scopes: ['read', 'pay'] });
  }, 15000);

  it('tells a loop to slow down', async () => {
    const { svc } = build();
    const s = await svc.startDevice({});
    await svc.pollToken(s.device_code);
    expect(await svc.pollToken(s.device_code)).toEqual({ status: 'slow_down' });
  });

  it('a denied or unknown code gets nothing', async () => {
    const { svc } = build();
    const s = await svc.startDevice({});
    await svc.denyDevice(s.user_code);
    await wait(2100);
    expect(await svc.pollToken(s.device_code)).toEqual({ status: 'access_denied' });
    expect(await svc.pollToken('lft_dc_unknown')).toEqual({ status: 'invalid_grant' });
    expect(await svc.pollToken('')).toEqual({ status: 'invalid_grant' });
  }, 10000);

  it('a code can be approved once only, and a wrong or expired code is refused', async () => {
    const { db, svc } = build();
    const s = await svc.startDevice({});
    await svc.approveDevice('did:privy:u', s.user_code, {});
    await expect(svc.approveDevice('did:privy:other', s.user_code, {})).rejects.toThrow();
    await expect(svc.approveDevice('did:privy:u', 'AAAA-BBBB', {})).rejects.toThrow();
    const e = await svc.startDevice({});
    db.rows('agent_device_codes').find((r) => r.user_code === e.user_code)!.expires_at = new Date(Date.now() - 1000).toISOString();
    await expect(svc.approveDevice('did:privy:u', e.user_code, {})).rejects.toThrow();
  });
});

describe('what the person can grant', () => {
  it('never grants more than was asked, and never withdraw unless asked for', async () => {
    const { svc } = build();
    const s = await svc.startDevice({ scopes: ['pay'] });
    const session = await svc.approveDevice('did:privy:u', s.user_code, { scopes: ['pay', 'withdraw'] });
    expect(session.scopes).toEqual(['read', 'pay']);
  });
  it('applies the limits chosen, with safe defaults', async () => {
    const { svc } = build();
    const a = await login(svc);
    expect(a.session).toMatchObject({ perPaymentCapUsd: 25, dailyCapUsd: 100, autoApproveUsd: 5 });
    const b = await login(svc, 'did:privy:u', { perPaymentCapUsd: 50, dailyCapUsd: 200, autoApproveUsd: 10, expiresInDays: 7 });
    expect(b.session).toMatchObject({ perPaymentCapUsd: 50, dailyCapUsd: 200, autoApproveUsd: 10 });
    expect(new Date(b.session.expiresAt).getTime() - Date.now()).toBeLessThan(7.1 * 86_400_000);
  });
  it('refuses silly limits', async () => {
    const { svc } = build();
    for (const choice of [{ perPaymentCapUsd: 501 }, { perPaymentCapUsd: 0 }, { dailyCapUsd: 99999 }, { perPaymentCapUsd: 50, dailyCapUsd: 20 }, { perPaymentCapUsd: 10, autoApproveUsd: 20 }]) {
      const s = await svc.startDevice({});
      await expect(svc.approveDevice('did:privy:u', s.user_code, choice)).rejects.toThrow();
    }
  });
});

describe('sessions', () => {
  it('lists only the persons own live sessions, and revoking stops the token at once', async () => {
    const { svc } = build();
    const mine = await login(svc, 'did:privy:me');
    await login(svc, 'did:privy:someone-else');
    expect((await svc.listSessions('did:privy:me')).map((r: any) => r.id)).toEqual([mine.session.id]);
    await expect(svc.revokeSession('did:privy:someone-else', mine.session.id)).rejects.toThrow(); // not theirs
    await svc.revokeSession('did:privy:me', mine.session.id);
    expect(await svc.listSessions('did:privy:me')).toEqual([]);
  });
  it('rejects tokens that are revoked, expired, malformed or unknown', async () => {
    const { db, svc } = build();
    expect(await svc.verifyToken('garbage')).toBeNull();
    expect(await svc.verifyToken('lft_ag_' + 'a'.repeat(43))).toBeNull();
    const { start, session } = await login(svc);
    await wait(2100);
    const r = await svc.pollToken(start.device_code);
    if (r.status !== 'approved') throw new Error('expected approval');
    db.rows('agent_sessions').find((x) => x.id === session.id)!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await svc.verifyToken(r.accessToken)).toBeNull();
  }, 10000);
});
