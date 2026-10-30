import { mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export interface Credentials {
  token: string;
  api: string;
  expiresAt?: string;
}

export const DEFAULT_API = 'https://api.loofta.xyz';
export const credentialsPath = () => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'loofta', 'credentials.json');

/** LOOFTA_TOKEN wins, so a hosted agent can be configured with an environment variable and no file. */
export function loadCredentials(): Credentials | null {
  if (process.env.LOOFTA_TOKEN) return { token: process.env.LOOFTA_TOKEN, api: process.env.LOOFTA_API ?? DEFAULT_API };
  try {
    const c = JSON.parse(readFileSync(credentialsPath(), 'utf8')) as Credentials;
    return c?.token ? { ...c, api: process.env.LOOFTA_API ?? c.api ?? DEFAULT_API } : null;
  } catch {
    return null;
  }
}

export function saveCredentials(c: Credentials) {
  const p = credentialsPath();
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(c, null, 2), { mode: 0o600 });
  chmodSync(p, 0o600);
}

export function clearCredentials() {
  rmSync(credentialsPath(), { force: true });
}
