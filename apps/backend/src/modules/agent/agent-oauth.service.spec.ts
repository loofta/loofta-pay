import { createHash, randomBytes } from 'crypto';
import { AgentOauthService, OAuthError, isAllowedRedirect } from './agent-oauth.service';
import { AgentAuthService } from './agent-auth.service';
import { TestDb } from './test-db';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

function build() {
  const db = new TestDb();
  const config: any = { get: () => undefined };
  const auth = new AgentAuthService(db as any, config);
  const oauth = new AgentOauthService(db as any, auth);
  return { db, auth, oauth };
}

async function connect(oauth: AgentOauthService, redirect = REDIRECT) {
  const client = await oauth.register({ client_name: 'Claude', redirect_uris: [redirect] });
  const { verifier, challenge } = pkce();
  const { redirect_to } = await oauth.approve('did:privy:u', {
    clientId: client.client_id, redirectUri: redirect, codeChallenge: challenge, state: 'st8', limits: { perPaymentCapUsd: 20, dailyCapUsd: 50, autoApproveUsd: 3 },
  });
  const url = new URL(redirect_to);
  return { client, verifier, code: url.searchParams.get('code')!, url };
}

describe('hosted login (OAuth + PKCE)', () => {
  it('registers a client, approves in the app, and swaps the code for a working session token', async () => {
    const { oauth, auth } = build();
    const { client, verifier, code, url } = await connect(oauth);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('st8');
    const t = await oauth.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: REDIRECT });
    expect(t.token_type).toBe('Bearer');
    expect(t.access_token).toMatch(/^lft_ag_/);
    const session = await auth.verifyToken(t.access_token);
    expect(session).toMatchObject({ userId: 'did:privy:u', label: 'Claude', perPaymentCapUsd: 20, dailyCapUsd: 50, autoApproveUsd: 3 });
    expect(session!.scopes).toEqual(['read', 'pay']);
  });

  it('a code works once; using it again revokes the session it made', async () => {
    const { oauth, auth } = build();
    const { client, verifier, code } = await connect(oauth);
    const body = { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: REDIRECT };
    const first = await oauth.exchange(body);
    await expect(oauth.exchange(body)).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await auth.verifyToken(first.access_token)).toBeNull();
  });

  it('refuses a wrong verifier, a different client or redirect, and an expired code', async () => {
    const { oauth, db } = build();
    const a = await connect(oauth);
    const base = { grant_type: 'authorization_code', code: a.code, client_id: a.client.client_id, redirect_uri: REDIRECT };
    await expect(oauth.exchange({ ...base, code_verifier: pkce().verifier })).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(oauth.exchange({ ...base, code_verifier: a.verifier, client_id: 'someone-else' })).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(oauth.exchange({ ...base, code_verifier: a.verifier, redirect_uri: 'https://evil.example/cb' })).rejects.toMatchObject({ code: 'invalid_grant' });
    db.rows('agent_oauth_codes')[0].expires_at = new Date(Date.now() - 1000).toISOString();
    await expect(oauth.exchange({ ...base, code_verifier: a.verifier })).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('only sends people back to the address the client registered', async () => {
    const { oauth } = build();
    const client = await oauth.register({ client_name: 'Claude', redirect_uris: [REDIRECT] });
    const { challenge } = pkce();
    await expect(oauth.approve('did:privy:u', { clientId: client.client_id, redirectUri: 'https://evil.example/cb', codeChallenge: challenge, limits: {} })).rejects.toThrow(/did not register/);
    await expect(oauth.describe('nope', REDIRECT)).rejects.toThrow(/Unknown app/);
    expect(await oauth.describe(client.client_id, REDIRECT)).toEqual({ client_name: 'Claude' });
  });

  it('requires an S256 challenge and sane registration', async () => {
    const { oauth } = build();
    const client = await oauth.register({ client_name: 'Claude', redirect_uris: [REDIRECT] });
    await expect(oauth.approve('did:privy:u', { clientId: client.client_id, redirectUri: REDIRECT, codeChallenge: 'short', limits: {} })).rejects.toThrow(/PKCE/);
    await expect(oauth.register({ redirect_uris: ['javascript:alert(1)'] })).rejects.toBeInstanceOf(OAuthError);
    await expect(oauth.register({ redirect_uris: [] })).rejects.toBeInstanceOf(OAuthError);
    expect(isAllowedRedirect('http://localhost:33418/callback')).toBe(true);
    expect(isAllowedRedirect('http://example.com/cb')).toBe(false);
    expect(isAllowedRedirect('cursor://anysphere.cursor-retrieval/oauth/callback')).toBe(true);
  });

  it('the limits are the same ones the CLI login enforces', async () => {
    const { oauth } = build();
    const client = await oauth.register({ client_name: 'Claude', redirect_uris: [REDIRECT] });
    const { challenge } = pkce();
    await expect(oauth.approve('did:privy:u', { clientId: client.client_id, redirectUri: REDIRECT, codeChallenge: challenge, limits: { perPaymentCapUsd: 9999 } })).rejects.toThrow(/between/);
  });
});
