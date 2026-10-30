#!/usr/bin/env node
import { login } from './login.js';
import { serve } from './server.js';
import { clearCredentials, loadCredentials } from './store.js';
import { loofta } from './api.js';

const cmd = process.argv[2];
try {
  if (cmd === 'login') await login();
  else if (cmd === 'logout') { clearCredentials(); console.error('Logged out on this machine. Disconnect the agent in the Loofta app to revoke it everywhere.'); }
  else if (cmd === 'whoami') {
    const c = loadCredentials();
    if (!c) { console.error('Not logged in. Run: loofta login'); process.exit(1); }
    console.log(JSON.stringify(await loofta(c.api, c.token).me(), null, 2));
  } else if (!cmd || cmd === 'serve') serve();
  else { console.error('Usage: loofta login | logout | whoami | serve (default, runs the MCP server)'); process.exit(1); }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
