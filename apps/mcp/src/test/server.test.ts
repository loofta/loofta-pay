import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server.js';

test('lists the tools', async () => {
  const r: any = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(r.result.tools.map((t: any) => t.name), ['whoami', 'quote_payment', 'pay', 'contacts', 'lookup_recipient', 'get_payment', 'list_payments']);
});
test('notifications get no reply', async () => {
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});
test('a tool call without login explains how to log in instead of crashing', async () => {
  process.env.XDG_CONFIG_HOME = '/nonexistent-loofta-test';
  delete process.env.LOOFTA_TOKEN;
  const r: any = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /login/);
});
test('initialize echoes the protocol version', async () => {
  const r: any = await handle({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal(r.result.protocolVersion, '2024-11-05');
});
