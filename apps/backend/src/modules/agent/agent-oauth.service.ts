import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';
import { AgentAuthService } from './agent-auth.service';
import { hashToken } from './agent-token';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_REDIRECTS = 5;

export class OAuthError extends Error {
  constructor(public code: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type', message: string) {
    super(message);
  }
}

/** A redirect target we are willing to send a person back to: https, localhost for desktop tools, or an app scheme. Never javascript:/data:. */
export function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    return !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:'].includes(u.protocol);
  } catch {
    return false;
  }
}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/**
 * OAuth 2.1 (authorization code + PKCE, public clients) so Claude, ChatGPT and other MCP clients can log
 * a person in without a CLI. The login ends in the same revocable session token as the CLI login.
 */
@Injectable()
export class AgentOauthService {
  constructor(
    private readonly db: SupabaseService,
    private readonly auth: AgentAuthService,
  ) {}

  /** RFC 7591 dynamic client registration. */
  async register(body: { client_name?: unknown; redirect_uris?: unknown }) {
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > MAX_REDIRECTS || !uris.every(isAllowedRedirect)) {
      throw new OAuthError('invalid_request', 'redirect_uris must be 1 to 5 https URLs (or localhost / app scheme URLs).');
    }
    const name = String(body?.client_name ?? 'Agent').replace(/[^\p{L}\p{N} ._@-]/gu, '').trim().slice(0, 60) || 'Agent';
    const client_id = `lft_cl_${randomBytes(18).toString('base64url')}`;
    const { error } = await this.db.getClient().from('agent_oauth_clients').insert({ client_id, client_name: name, redirect_uris: uris });
    if (error) throw new OAuthError('invalid_request', 'Could not register this client.');
    return { client_id, client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] };
  }

  private async client(clientId: string, redirectUri: string) {
    const { data } = await this.db.getClient().from('agent_oauth_clients').select('*').eq('client_id', clientId).maybeSingle();
    if (!data) throw new BadRequestException('Unknown app. Start the connection again from your agent.');
    // Exact match: a redirect to anywhere else would hand the code to someone else.
    if (!(data.redirect_uris as string[]).includes(redirectUri)) throw new BadRequestException('This app asked to return to an address it did not register.');
    return data as { client_id: string; client_name: string; redirect_uris: string[] };
  }

  /** What the consent screen shows. */
  async describe(clientId: string, redirectUri: string) {
    const c = await this.client(clientId, redirectUri);
    return { client_name: c.client_name };
  }

  /** The person approved in the app: make the session and a one-time code, and say where to send them back. */
  async approve(
    userId: string,
    p: { clientId: string; redirectUri: string; codeChallenge: string; codeChallengeMethod?: string; state?: string; ip?: string; limits: Parameters<AgentAuthService['createSession']>[1] },
  ) {
    const c = await this.client(p.clientId, p.redirectUri);
    if ((p.codeChallengeMethod ?? 'S256') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(p.codeChallenge ?? '')) {
      throw new BadRequestException('This app did not send a valid PKCE challenge.');
    }
    const session = await this.auth.createSession(userId, { ...p.limits, label: c.client_name, ip: p.ip });
    const code = `lft_ac_${randomBytes(32).toString('base64url')}`;
    const { error } = await this.db.getClient().from('agent_oauth_codes').insert({
      code_hash: hashToken(code),
      client_id: c.client_id,
      redirect_uri: p.redirectUri,
      code_challenge: p.codeChallenge,
      user_id: userId,
      session_id: session.id,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    });
    if (error) {
      await this.db.getClient().from('agent_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', session.id);
      throw new BadRequestException('Could not connect this agent. Please try again.');
    }
    const url = new URL(p.redirectUri);
    url.searchParams.set('code', code);
    if (p.state) url.searchParams.set('state', p.state);
    return { redirect_to: url.toString() };
  }

  /** The client swaps its code (and PKCE verifier) for the token, once. */
  async exchange(body: Record<string, unknown>) {
    if (body.grant_type !== 'authorization_code') throw new OAuthError('unsupported_grant_type', 'Only authorization_code is supported.');
    const code = String(body.code ?? '');
    const verifier = String(body.code_verifier ?? '');
    if (!code.startsWith('lft_ac_') || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError('invalid_request', 'Missing or malformed code or code_verifier.');

    const supabase = this.db.getClient();
    const { data: row } = await supabase.from('agent_oauth_codes').select('*').eq('code_hash', hashToken(code)).maybeSingle();
    if (!row) throw new OAuthError('invalid_grant', 'That code is not valid.');
    if (row.used_at) {
      // A code used twice means it leaked: kill the session it produced.
      await supabase.from('agent_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', row.session_id);
      throw new OAuthError('invalid_grant', 'That code was already used.');
    }
    if (new Date(row.expires_at).getTime() < Date.now()) throw new OAuthError('invalid_grant', 'That code expired.');
    if (row.client_id !== String(body.client_id ?? '') || row.redirect_uri !== String(body.redirect_uri ?? '')) {
      throw new OAuthError('invalid_grant', 'client_id or redirect_uri does not match the request.');
    }
    if (s256(verifier) !== row.code_challenge) throw new OAuthError('invalid_grant', 'The code_verifier does not match.');

    const { data: flipped } = await supabase.from('agent_oauth_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id).is('used_at', null).select('id');
    if (!flipped?.length) throw new OAuthError('invalid_grant', 'That code was already used.');
    const issued = await this.auth.issueToken(row.session_id);
    if (!issued) throw new OAuthError('invalid_grant', 'This connection was revoked.');
    return {
      access_token: issued.token,
      token_type: 'Bearer',
      expires_in: Math.max(60, Math.floor((new Date(issued.session.expiresAt).getTime() - Date.now()) / 1000)),
      scope: issued.session.scopes.join(' '),
    };
  }
}
