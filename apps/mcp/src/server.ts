import { createInterface } from 'node:readline';
import { callTool, TOOLS } from './tools.js';

type Rpc = { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: any };

/** Minimal MCP over stdio (newline-delimited JSON-RPC): initialize, tools/list, tools/call. No dependencies. */
export async function handle(msg: Rpc): Promise<object | null> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined) return null; // notifications get no reply
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'loofta', version: '0.1.0' },
        instructions: 'Pay people from the user\'s Loofta wallet. Use quote_payment first for anything unusual. If pay returns needs_approval, show the approval_url to the user.',
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        const out = await callTool(msg.params?.name, msg.params?.arguments);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return reply({ isError: true, content: [{ type: 'text', text: (e as Error).message }] });
      }
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export function serve() {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg: Rpc;
    try { msg = JSON.parse(line); } catch { return; }
    const out = await handle(msg);
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  });
}
