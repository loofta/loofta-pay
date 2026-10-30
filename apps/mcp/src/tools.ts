import { randomUUID } from 'node:crypto';
import { ApiError, loofta, type PaymentInput } from './api.js';
import { loadCredentials } from './store.js';

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

export const TOOLS = [
  { name: 'whoami', description: 'Show the connected Loofta account, wallet balance, and what this session may spend.', inputSchema: { type: 'object', properties: {} } },
  { name: 'quote_payment', description: 'Check a payment without sending it: fees, who is new to Loofta, whether the person must approve it. Always safe to call.', inputSchema: { type: 'object', properties: paymentProps, required: ['payments'] } },
  {
    name: 'pay',
    description: 'Send USDC from the connected Loofta wallet to people. Small payments to people already paid before go straight through. Larger or first-time payments return status needs_approval with an approval_url: give that URL to the user and then poll get_payment. Never retry a payment that returned an id; check it with get_payment instead.',
    inputSchema: { type: 'object', properties: { ...paymentProps, idempotency_key: { type: 'string', description: 'Reuse the same key when retrying the same payment so it is never sent twice.' } }, required: ['payments'] },
  },
  { name: 'contacts', description: `People the user has paid before, most recent first. Use this to turn "pay Alice again" into a real recipient.`, inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'lookup_recipient', description: 'Check whether a recipient is on Loofta (money arrives directly) or not (they get a claim link).', inputSchema: { type: 'object', properties: { recipient: { type: 'string' } }, required: ['recipient'] } },
  { name: 'get_payment', description: 'Status of a payment, including approval state and per-recipient results.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'list_payments', description: 'Recent payments made by this session.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
];

export async function callTool(name: string, args: any): Promise<unknown> {
  const creds = loadCredentials();
  if (!creds) throw new ApiError(401, 'not_logged_in', 'Not logged in. Run `npx @loofta/mcp login` in a terminal, then try again.');
  const api = loofta(creds.api, creds.token);
  const input = (): PaymentInput => ({ payments: args?.payments, privately: args?.privately, delay_minutes: args?.delay_minutes, split: args?.split });
  switch (name) {
    case 'whoami': return api.me();
    case 'quote_payment': return api.quote(input());
    case 'pay': return api.pay(input(), String(args?.idempotency_key || randomUUID()));
    case 'contacts': return api.contacts(Number(args?.limit) || 30);
    case 'lookup_recipient': return api.lookup(String(args?.recipient ?? ''));
    case 'get_payment': return api.get(String(args?.id));
    case 'list_payments': return api.list(Number(args?.limit) || 20);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
