import { hostname } from 'node:os';
import { authApi } from './api.js';
import { DEFAULT_API, saveCredentials } from './store.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Device-code login: show a short code, the person approves it in the Loofta app, we collect the token. */
export async function login(log: (s: string) => void = (s) => process.stderr.write(s + '\n')) {
  const api = process.env.LOOFTA_API ?? DEFAULT_API;
  const a = authApi(api);
  const d = await a.start(`${process.env.LOOFTA_AGENT_NAME ?? 'Agent'} on ${hostname()}`);
  log(`\nOpen ${d.verification_url} and enter this code:\n\n    ${d.user_code}\n\nWaiting for you to approve it…`);
  const deadline = Date.now() + d.expires_in * 1000;
  let wait = d.interval * 1000;
  while (Date.now() < deadline) {
    await sleep(wait);
    const r = await a.poll(d.device_code);
    if (r.ok) {
      saveCredentials({ token: r.data.access_token, api, expiresAt: r.data.expires_at });
      log('Logged in. Your agent can pay people now, within the limits you set.');
      return;
    }
    if (r.error === 'slow_down') wait += 2000;
    else if (r.error === 'access_denied') throw new Error('You declined the login.');
    else if (r.error !== 'authorization_pending') throw new Error('The login expired. Run it again.');
  }
  throw new Error('The login expired. Run it again.');
}
