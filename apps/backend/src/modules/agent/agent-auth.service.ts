import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';
import {
  generateSessionToken, generateDeviceCode, generateUserCode, normalizeUserCode, hashToken,
  looksLikeSessionToken, sanitizeScopes, type AgentScope,
} from './agent-token';

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_S = 3;
const MAX_PER_PAYMENT_USD = 500;
const MAX_DAILY_USD = 5000;

export interface AgentSession {
  id: string;
  userId: string;
  label: string;
  scopes: AgentScope[];
  perPaymentCapUsd: number;
  dailyCapUsd: number;
  autoApproveUsd: number;
  expiresAt: string;
}

export type PollResult =
  | { status: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' | 'invalid_grant' }
  | { status: 'approved'; accessToken: string; session: AgentSession };

const toSession = (r: any): AgentSession => ({
  id: r.id,
  userId: r.user_id,
  label: r.label,
  scopes: r.scopes,
  perPaymentCapUsd: Number(r.per_payment_cap_usd),
  dailyCapUsd: Number(r.daily_cap_usd),
  autoApproveUsd: Number(r.auto_approve_usd),
  expiresAt: r.expires_at,
});

/**
 * Logging an agent in, in the style of `gh auth login`. The agent asks for a code and shows it to the
 * person; the person types it into the app (signed in as themselves) and picks the limits; the agent
 * then collects a session token exactly once. The token is created at that moment and only its hash is
 * stored, so nothing readable is ever kept.
 */
@Injectable()
export class AgentAuthService {
  private readonly logger = new Logger(AgentAuthService.name);

  constructor(
    private readonly db: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  private get appUrl() {
    return (this.config.get<string>('NEXT_PUBLIC_APP_URL') || this.config.get<string>('NEXT_PUBLIC_BASE_URL') || 'https://pay.loofta.xyz').replace(/\/$/, '');
  }

  // ---------------------------------------------------------------------------------------------
  // The agent's side

  async startDevice(opts: { label?: string; scopes?: unknown; ip?: string; userAgent?: string }) {
    const label = String(opts.label ?? 'Agent').replace(/[^\p{L}\p{N} ._@-]/gu, '').trim().slice(0, 60) || 'Agent';
    const scopes = sanitizeScopes(opts.scopes ?? ['pay']);
    for (let attempt = 0; attempt < 5; attempt++) {
      const userCode = generateUserCode();
      const { deviceCode, hash } = generateDeviceCode();
      const { error } = await this.db.getClient().from('agent_device_codes').insert({
        device_code_hash: hash,
        user_code: userCode,
        label,
        requested_scopes: scopes,
        status: 'pending',
        expires_at: new Date(Date.now() + DEVICE_CODE_TTL_MS).toISOString(),
        requester_ip: opts.ip ?? null,
        requester_agent: (opts.userAgent ?? '').slice(0, 200) || null,
      });
      if (error?.code === '23505') continue; // a code that collided: draw another
      if (error) {
        this.logger.error(`startDevice insert failed: ${error.message}`);
        throw new BadRequestException('Could not start the login. Please try again.');
      }
      return {
        device_code: deviceCode,
        user_code: userCode,
        verification_url: `${this.appUrl}/agent`,
        expires_in: DEVICE_CODE_TTL_MS / 1000,
        interval: POLL_INTERVAL_S,
      };
    }
    throw new BadRequestException('Could not start the login. Please try again.');
  }

  /** The agent collects its token. Works once; later polls get invalid_grant. */
  async pollToken(deviceCode: string): Promise<PollResult> {
    if (!deviceCode || !deviceCode.startsWith('lft_dc_')) return { status: 'invalid_grant' };
    const supabase = this.db.getClient();
    const { data: row } = await supabase.from('agent_device_codes').select('*').eq('device_code_hash', hashToken(deviceCode)).maybeSingle();
    if (!row) return { status: 'invalid_grant' };
    if (row.status === 'consumed') return { status: 'invalid_grant' };
    if (new Date(row.expires_at).getTime() < Date.now() && row.status !== 'approved') return { status: 'expired_token' };
    if (row.status === 'denied') return { status: 'access_denied' };

    // Do not let a loop hammer this.
    const last = row.last_polled_at ? new Date(row.last_polled_at).getTime() : 0;
    await supabase.from('agent_device_codes').update({ last_polled_at: new Date().toISOString() }).eq('id', row.id);
    if (Date.now() - last < (POLL_INTERVAL_S - 1) * 1000) return { status: 'slow_down' };
    if (row.status === 'pending') return { status: 'authorization_pending' };

    // approved: claim it atomically so only one poll ever gets the token.
    const { data: claimed } = await supabase
      .from('agent_device_codes')
      .update({ status: 'consumed' })
      .eq('id', row.id)
      .eq('status', 'approved')
      .select('session_id');
    if (!claimed?.length || !claimed[0].session_id) return { status: 'invalid_grant' };

    const { token, hash, prefix } = generateSessionToken();
    const { data: sessionRow, error } = await supabase
      .from('agent_sessions')
      .update({ token_hash: hash, token_prefix: prefix })
      .eq('id', claimed[0].session_id)
      .select('*')
      .single();
    if (error || !sessionRow) {
      this.logger.error(`pollToken could not issue the token: ${error?.message}`);
      return { status: 'invalid_grant' };
    }
    return { status: 'approved', accessToken: token, session: toSession(sessionRow) };
  }

  // ---------------------------------------------------------------------------------------------
  // The person's side (signed in to the app)

  /** What the person sees before approving: who is asking, from where, and for what. */
  async describeDevice(userCodeInput: string) {
    const row = await this.findPending(userCodeInput);
    return {
      label: row.label,
      requested_scopes: row.requested_scopes as AgentScope[],
      requester_ip: row.requester_ip,
      requester_agent: row.requester_agent,
      created_at: row.created_at,
      expires_at: row.expires_at,
    };
  }

  private async findPending(userCodeInput: string) {
    const code = normalizeUserCode(userCodeInput);
    const notFound = new NotFoundException('That code was not found or has expired. Start the login again from your agent.');
    if (!code) throw notFound;
    const { data: row } = await this.db.getClient().from('agent_device_codes').select('*').eq('user_code', code).eq('status', 'pending').maybeSingle();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) throw notFound;
    return row;
  }

  async approveDevice(
    userId: string,
    userCodeInput: string,
    choice: { label?: string; scopes?: unknown; perPaymentCapUsd?: number; dailyCapUsd?: number; autoApproveUsd?: number; expiresInDays?: number },
  ): Promise<AgentSession> {
    const row = await this.findPending(userCodeInput);
    const perPayment = this.cap(choice.perPaymentCapUsd, 25, MAX_PER_PAYMENT_USD, 'Per-payment limit');
    const daily = this.cap(choice.dailyCapUsd, 100, MAX_DAILY_USD, 'Daily limit');
    if (perPayment > daily) throw new BadRequestException('The per-payment limit cannot be higher than the daily limit.');
    const autoApprove = this.cap(choice.autoApproveUsd, 5, perPayment, 'Auto-approve limit', true);
    const days = Math.min(90, Math.max(1, Math.round(Number(choice.expiresInDays ?? 30))));
    // The person can only grant what was asked for: never more.
    const asked = new Set<string>(row.requested_scopes);
    const granted = sanitizeScopes(choice.scopes ?? row.requested_scopes).filter((s) => s === 'read' || asked.has(s));
    const label = String(choice.label ?? row.label).replace(/[^\p{L}\p{N} ._@-]/gu, '').trim().slice(0, 60) || 'Agent';

    const supabase = this.db.getClient();
    const { data: session, error } = await supabase
      .from('agent_sessions')
      .insert({
        user_id: userId,
        label,
        token_hash: `pending:${randomUUID()}`,
        token_prefix: 'pending',
        scopes: granted,
        per_payment_cap_usd: perPayment,
        daily_cap_usd: daily,
        auto_approve_usd: autoApprove,
        expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
        created_from_ip: row.requester_ip,
      })
      .select('*')
      .single();
    if (error || !session) {
      this.logger.error(`approveDevice session insert failed: ${error?.message}`);
      throw new BadRequestException('Could not approve this login. Please try again.');
    }
    // Flip pending -> approved atomically; if it was taken in the meantime, drop the session just made.
    const { data: flipped } = await supabase
      .from('agent_device_codes')
      .update({ status: 'approved', user_id: userId, session_id: session.id })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id');
    if (!flipped?.length) {
      await supabase.from('agent_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', session.id);
      throw new NotFoundException('That code was already used. Start the login again from your agent.');
    }
    return toSession(session);
  }

  /** A session created straight from the app (hosted MCP login). The token is issued later, when the client swaps its code. */
  async createSession(
    userId: string,
    choice: { label?: string; perPaymentCapUsd?: number; dailyCapUsd?: number; autoApproveUsd?: number; expiresInDays?: number; ip?: string },
  ): Promise<AgentSession> {
    const perPayment = this.cap(choice.perPaymentCapUsd, 25, MAX_PER_PAYMENT_USD, 'Per-payment limit');
    const daily = this.cap(choice.dailyCapUsd, 100, MAX_DAILY_USD, 'Daily limit');
    if (perPayment > daily) throw new BadRequestException('The per-payment limit cannot be higher than the daily limit.');
    const autoApprove = this.cap(choice.autoApproveUsd, 5, perPayment, 'Auto-approve limit', true);
    const days = Math.min(90, Math.max(1, Math.round(Number(choice.expiresInDays ?? 30))));
    const label = String(choice.label ?? 'Agent').replace(/[^\p{L}\p{N} ._@-]/gu, '').trim().slice(0, 60) || 'Agent';
    const { data, error } = await this.db
      .getClient()
      .from('agent_sessions')
      .insert({
        user_id: userId,
        label,
        token_hash: `pending:${randomUUID()}`,
        token_prefix: 'pending',
        scopes: ['read', 'pay'],
        per_payment_cap_usd: perPayment,
        daily_cap_usd: daily,
        auto_approve_usd: autoApprove,
        expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
        created_from_ip: choice.ip ?? null,
      })
      .select('*')
      .single();
    if (error || !data) {
      this.logger.error(`createSession failed: ${error?.message}`);
      throw new BadRequestException('Could not connect this agent. Please try again.');
    }
    return toSession(data);
  }

  /** Mints the token for a session that has none yet. Only its hash is stored. */
  async issueToken(sessionId: string): Promise<{ token: string; session: AgentSession } | null> {
    const { token, hash, prefix } = generateSessionToken();
    const { data, error } = await this.db
      .getClient()
      .from('agent_sessions')
      .update({ token_hash: hash, token_prefix: prefix })
      .eq('id', sessionId)
      .eq('token_prefix', 'pending')
      .is('revoked_at', null)
      .select('*')
      .single();
    if (error || !data) return null;
    return { token, session: toSession(data) };
  }

  async denyDevice(userCodeInput: string): Promise<void> {
    const row = await this.findPending(userCodeInput);
    await this.db.getClient().from('agent_device_codes').update({ status: 'denied' }).eq('id', row.id).eq('status', 'pending');
  }

  private cap(v: unknown, fallback: number, max: number, name: string, allowZero = false): number {
    const n = v === undefined || v === null ? fallback : Number(v);
    if (!Number.isFinite(n) || n < (allowZero ? 0 : 0.01) || n > max) {
      throw new BadRequestException(`${name} must be between $${allowZero ? 0 : 0.01} and $${max}.`);
    }
    return Math.round(n * 100) / 100;
  }

  async listSessions(userId: string) {
    const { data } = await this.db
      .getClient()
      .from('agent_sessions')
      .select('id, label, token_prefix, scopes, per_payment_cap_usd, daily_cap_usd, auto_approve_usd, created_at, expires_at, last_used_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const { data } = await this.db
      .getClient()
      .from('agent_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id');
    if (!data?.length) throw new NotFoundException('Session not found.');
  }

  // ---------------------------------------------------------------------------------------------
  // Every agent request

  async verifyToken(raw: string): Promise<AgentSession | null> {
    if (!looksLikeSessionToken(raw)) return null;
    const supabase = this.db.getClient();
    const { data: row } = await supabase.from('agent_sessions').select('*').eq('token_hash', hashToken(raw)).maybeSingle();
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return null;
    const last = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
    if (Date.now() - last > 60_000) {
      await supabase.from('agent_sessions').update({ last_used_at: new Date().toISOString() }).eq('id', row.id);
    }
    return toSession(row);
  }
}
