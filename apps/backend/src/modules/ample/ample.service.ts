import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BASE = 'https://api.ample.money/v1';
const NETWORK = 'SOLANA';

type Tier = { kind: 'key' } | { kind: 'session'; userId: string };

interface CachedSession {
  token: string;
  expiresAtMs: number;
  scopes: string[];
}

/**
 * Ample partner API (https://api.ample.money/v1). Ample never signs or holds funds: it returns data
 * and UNSIGNED transactions that the user's own wallet signs.
 *
 * Everything is proxied through here so the API key never reaches a browser and Loofta's origins do
 * not have to be registered with Ample. partnerUserId is always the caller's Privy id, taken from
 * the verified auth token by the controller, never from a request body.
 */
@Injectable()
export class AmpleService {
  private readonly logger = new Logger(AmpleService.name);
  private readonly sessions = new Map<string, CachedSession>();
  private txScopeDenied = false;
  private vaultCache: { at: number; data: any } | null = null;

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    return (this.config.get<string>('AMPLE_API_KEY') || '').trim();
  }

  isEnabled(): boolean {
    return !!this.apiKey;
  }

  private async call<T = any>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    tier: Tier,
    opts: { body?: unknown; query?: Record<string, string | undefined> } = {},
    retriedAuth = false,
  ): Promise<T> {
    if (!this.isEnabled()) throw new ServiceUnavailableException('Stake to win is not available yet');
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) qs.set(k, v);
    const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ''}`;
    const bearer = tier.kind === 'key' ? this.apiKey : (await this.getSession(tier.userId)).token;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e: any) {
      this.logger.warn(`Ample ${method} ${path} network error: ${e?.message}`);
      throw new ServiceUnavailableException('Could not reach the staking provider, try again');
    }
    if (res.status === 204) return undefined as T;
    const json: any = await res.json().catch(() => null);
    if (res.ok) return json as T;

    const code: string = json?.error?.code ?? 'AMPLE_UNKNOWN';
    // Expired or revoked session: mint once more and retry once (per Ample's retry policy).
    if (tier.kind === 'session' && code === 'AMPLE_AUTH_TOKEN_EXPIRED' && !retriedAuth) {
      this.sessions.delete(tier.userId);
      return this.call<T>(method, path, tier, opts, true);
    }
    this.logger.warn(`Ample ${method} ${path} -> ${res.status} ${code} (${json?.error?.requestId ?? 'no-req-id'})`);
    throw new HttpException({ statusCode: res.status, code, message: json?.error?.message ?? 'Staking provider error' }, res.status);
  }

  /** One cached JWT per user, reused until 30s before expiry. Asks for `tx` and falls back to read-only if not approved. */
  private async getSession(userId: string): Promise<CachedSession> {
    const hit = this.sessions.get(userId);
    if (hit && hit.expiresAtMs - Date.now() > 30_000) return hit;
    const scopes = this.txScopeDenied ? ['read'] : ['read', 'tx'];
    let minted: any;
    try {
      minted = await this.call('POST', '/sessions', { kind: 'key' }, { body: { partnerUserId: userId, scopes } });
    } catch (e: any) {
      if (!this.txScopeDenied && e?.response?.code === 'AMPLE_SCOPE_NOT_PERMITTED') {
        this.txScopeDenied = true;
        this.logger.warn('Ample: partner not approved for the tx scope yet, running read-only');
        return this.getSession(userId);
      }
      throw e;
    }
    const s: CachedSession = { token: minted.token, expiresAtMs: new Date(minted.expiresAt).getTime(), scopes };
    this.sessions.set(userId, s);
    return s;
  }

  canBuildTransactions(): boolean {
    return this.isEnabled() && !this.txScopeDenied;
  }

  // ---- tier 1 ----

  async getLink(userId: string): Promise<{ linked: boolean; walletAddress?: string }> {
    try {
      const u = await this.call('GET', `/users/${encodeURIComponent(userId)}`, { kind: 'key' });
      if (u?.walletNetwork && u.walletNetwork !== NETWORK) return { linked: false };
      return { linked: true, walletAddress: u?.walletAddress };
    } catch (e: any) {
      if (e?.status === 404) return { linked: false };
      throw e;
    }
  }

  challenge(userId: string, walletAddress: string) {
    return this.call('POST', `/users/${encodeURIComponent(userId)}/challenge`, { kind: 'key' }, { body: { walletAddress } });
  }

  async link(userId: string, walletAddress: string, message: string, signature: string) {
    const out = await this.call('POST', '/users', { kind: 'key' }, { body: { partnerUserId: userId, walletAddress, message, signature } });
    this.sessions.delete(userId);
    return { walletAddress: out?.walletAddress, walletNetwork: out?.walletNetwork };
  }

  // ---- vaults (cached 2 min, Solana only) ----

  async listVaults() {
    if (this.vaultCache && Date.now() - this.vaultCache.at < 120_000) return this.vaultCache.data;
    const res = await this.call('GET', '/vaults', { kind: 'key' }, { query: { limit: '100' } });
    const rows: any[] = Array.isArray(res) ? res : res?.data ?? [];
    // Only the Solana USDC vault is on offer ("stake your USDC"); the SOL and JupUSD vaults are not.
    const data = rows.filter(v => (v?.network ?? '').toUpperCase() === NETWORK && v?.token?.symbol === 'USDC');
    this.vaultCache = { at: Date.now(), data };
    return data;
  }

  // ---- tier 2 (per-user session) ----

  async overview(userId: string) {
    const t: Tier = { kind: 'session', userId };
    const q = { network: NETWORK };
    const [tickets, balances, streak, claimable] = await Promise.all([
      this.call('GET', '/me/tickets', t, { query: q }),
      this.call('GET', '/me/balances', t),
      this.call('GET', '/me/streak', t, { query: q }),
      this.call('GET', '/me/payouts/claimable', t, { query: { ...q, limit: '50' } }),
    ]);
    const bal: any[] = Array.isArray(balances) ? balances : balances?.data ?? [];
    return {
      tickets,
      balances: bal.filter(b => (b?.network ?? '').toUpperCase() === NETWORK),
      streak,
      claimable: Array.isArray(claimable) ? claimable : claimable?.data ?? [],
    };
  }

  private requireTx() {
    if (this.txScopeDenied) throw new ServiceUnavailableException('Staking is opening soon');
  }

  async buildDeposit(userId: string, vaultId: string, amount: string) {
    this.requireTx();
    return this.call('POST', '/tx/deposit/quote', { kind: 'session', userId }, { body: { vaultId, fromAmount: amount } });
  }

  async buildWithdraw(userId: string, vaultId: string, amount: string) {
    this.requireTx();
    return this.call('POST', '/tx/withdraw', { kind: 'session', userId }, { body: { vaultId, amount } });
  }

  /** Solana claims take exactly one payout id per call and compound back into the vault. */
  async buildClaim(userId: string, payoutId: string) {
    this.requireTx();
    return this.call('POST', '/tx/claim', { kind: 'session', userId }, { body: { payoutIds: [payoutId], sourceChainId: 101 } });
  }

  txStatus(userId: string, hash: string) {
    return this.call('GET', `/tx/${encodeURIComponent(hash)}/status`, { kind: 'session', userId }, { query: { fromChainId: '101' } });
  }
}
