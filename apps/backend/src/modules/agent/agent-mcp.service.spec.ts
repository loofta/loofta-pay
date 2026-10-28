import { BadRequestException } from '@nestjs/common';
import { AgentMcpService, MCP_TOOLS } from './agent-mcp.service';
import type { AgentSession } from './agent-auth.service';

const session: AgentSession = { id: 's', userId: 'u', label: 'Claude', scopes: ['read', 'pay'], perPaymentCapUsd: 25, dailyCapUsd: 100, autoApproveUsd: 5, expiresAt: '2030-01-01' };
const build = () => {
  const payments: any = {
    me: jest.fn(async () => ({ balance_usd: 12 })),
    pay: jest.fn(async (_s: any, req: any, key: string) => ({ id: 'a1', status: 'paid', key, req })),
    quote: jest.fn(async () => { throw new BadRequestException({ code: 'bad_recipient', message: 'not a recipient' }); }),
  };
  return { svc: new AgentMcpService(payments), payments };
};
const rpc = (method: string, params?: any, id: number | null = 1) => ({ jsonrpc: '2.0', id: id as any, method, params });

describe('hosted MCP', () => {
  it('lists the same tools as the local package', async () => {
    const { svc } = build();
    const r: any = await svc.handle(session, rpc('tools/list'));
    expect(r.result.tools.map((t: any) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    expect(r.result.tools.map((t: any) => t.name)).toEqual(['whoami', 'quote_payment', 'pay', 'contacts', 'lookup_recipient', 'get_payment', 'list_payments']);
  });
  it('does not answer notifications', async () => {
    const { svc } = build();
    expect(await svc.handle(session, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });
  it('runs tools as the logged-in session, with a generated idempotency key when none is given', async () => {
    const { svc, payments } = build();
    const r: any = await svc.handle(session, rpc('tools/call', { name: 'pay', arguments: { payments: [{ recipient: '@alice', amount_usd: 2 }] } }));
    expect(r.result.isError).toBeUndefined();
    expect(payments.pay.mock.calls[0][0]).toBe(session);
    expect(payments.pay.mock.calls[0][2]).toHaveLength(36);
  });
  it('turns refusals into readable tool errors, not crashes', async () => {
    const { svc } = build();
    const r: any = await svc.handle(session, rpc('tools/call', { name: 'quote_payment', arguments: {} }));
    expect(r.result).toMatchObject({ isError: true });
    expect(r.result.content[0].text).toBe('bad_recipient: not a recipient');
    const unknown: any = await svc.handle(session, rpc('tools/call', { name: 'nope' }));
    expect(unknown.result.isError).toBe(true);
  });
});
