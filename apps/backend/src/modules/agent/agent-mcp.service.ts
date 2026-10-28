import { Injectable, HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentPaymentsService } from './agent-payments.service';
import type { AgentSession } from './agent-auth.service';

type Rpc = { jsonrpc?: string; id?: number | string | null; method?: string; params?: any };

const paymentProps = {
  payments: {
    type: 'array', minItems: 1, maxItems: 5,
    description: 'Who to pay and how much, up to 5 people. A recipient is a Loofta username ("@alice"), an email address, or a handle on another network: "x:alice", "telegram:alice", "discord:alice", "github:alice". Someone not on Loofta yet gets a claim link.',
    items: { type: 'object', properties: { recipient: { type: 'string' }, amount_usd: { type: 'number', description: 'USDC, at most 2 decimals' } }, required: ['recipient', 'amount_usd'] },
  },
  privately: { type: 'boolean', description: 'Pay through a private transfer so the sender and recipient wallets are not linked on-chain. Minimum $1. Costs extra.' },
  delay_minutes: { type: 'number', description: 'Private only: spread delivery over up to this many minutes (1-1440).' },
  split: { type: 'number', description: 'Private only: split into this many pieces (1-15).' },
};

export const MCP_TOOLS = [
  { name: 'whoami', description: 'Show the connected Loofta account, wallet balance, and what this session may spend.', inputSchema: { type: 'object', properties: {} } },
  { name: 'quote_payment', description: 'Check a payment without sending it: fees, who is new to Loofta, whether the person must approve it. Always safe to call.', inputSchema: { type: 'object', properties: paymentProps, required: ['payments'] } },
  {
    name: 'pay',
    description: "Send USDC from the connected Loofta wallet to people. Small payments to people already paid before go straight through. Larger or first-time payments return status needs_approval with an approval_url: give that URL to the user and then poll get_payment. Never retry a payment that returned an id; check it with get_payment instead.",
    inputSchema: { type: 'object', properties: { ...paymentProps, idempotency_key: { type: 'string', description: 'Reuse the same key when retrying the same payment so it is never sent twice.' } }, required: ['payments'] },
  },
  { name: 'contacts', description: 'People the user has paid before, most recent first. Use this to turn "pay Alice again" into a real recipient.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'lookup_recipient', description: 'Check whether a recipient is on Loofta (money arrives directly) or not (they get a claim link).', inputSchema: { type: 'object', properties: { recipient: { type: 'string' } }, required: ['recipient'] } },
  { name: 'get_payment', description: 'Status of a payment, including approval state and per-recipient results.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'list_payments', description: 'Recent payments made by this session.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
];

/** MCP over HTTP (JSON-RPC): the same tools as the local package, answered by the backend itself. */
@Injectable()
export class AgentMcpService {
  constructor(private readonly payments: AgentPaymentsService) {}

  /** Returns the JSON-RPC response, or null for a notification (no reply). */
  async handle(session: AgentSession, msg: Rpc): Promise<object | null> {
    if (msg?.id === undefined || msg?.id === null) return null;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: msg.params?.protocolVersion ?? '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'loofta', version: '0.1.0' },
          instructions: "Pay people from the user's Loofta wallet. Use quote_payment first for anything unusual. If pay returns needs_approval, show the approval_url to the user.",
        });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: MCP_TOOLS });
      case 'tools/call':
        try {
          const out = await this.call(session, String(msg.params?.name ?? ''), msg.params?.arguments ?? {});
          return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
        } catch (e) {
          return reply({ isError: true, content: [{ type: 'text', text: this.explain(e) }] });
        }
      default: return fail(-32601, `Method not found: ${msg.method}`);
    }
  }

  private explain(e: unknown): string {
    if (e instanceof HttpException) {
      const r: any = e.getResponse();
      const m = typeof r === 'string' ? r : r?.message;
      const text = typeof m === 'string' ? m : Array.isArray(m) ? m.join(', ') : e.message;
      return r?.code ? `${r.code}: ${text}` : text;
    }
    return 'Something went wrong. Nothing was sent.';
  }

  private call(session: AgentSession, name: string, args: any): Promise<unknown> {
    const input = () => ({ payments: args?.payments, privately: args?.privately, delay_minutes: args?.delay_minutes, split: args?.split });
    switch (name) {
      case 'whoami': return this.payments.me(session);
      case 'quote_payment': return this.payments.quote(session, input());
      case 'pay': return this.payments.pay(session, input(), String(args?.idempotency_key || randomUUID()));
      case 'contacts': return this.payments.contacts(session, Number(args?.limit) || 30);
      case 'lookup_recipient': return this.payments.lookup(session, String(args?.recipient ?? ''));
      case 'get_payment': return this.payments.get(session, String(args?.id ?? ''));
      case 'list_payments': return this.payments.list(session, Number(args?.limit) || 20);
      default: return Promise.reject(new HttpException(`Unknown tool: ${name}`, 400));
    }
  }
}
