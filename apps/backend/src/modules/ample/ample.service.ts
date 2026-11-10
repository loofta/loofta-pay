import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';

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

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

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

  private drawCache: { at: number; data: { nextDrawAt: string; drawIntervalSeconds: number; lastDrawStatus: string | null } | null } | null = null;

  /** Next draw time from Ample (cached 10s). Null if the call fails so stats still render. */
  async nextDraw() {
    if (this.drawCache && Date.now() - this.drawCache.at < 10_000) return this.drawCache.data;
    let data: { nextDrawAt: string; drawIntervalSeconds: number; lastDrawStatus: string | null } | null = null;
    try {
      const r: any = await this.call('GET', '/draws/next', { kind: 'key' }, { query: { network: NETWORK } });
      if (r?.nextDrawAt) {
        data = { nextDrawAt: String(r.nextDrawAt), drawIntervalSeconds: Number(r.drawIntervalSeconds) || 604800, lastDrawStatus: r.lastDrawStatus ?? null };
      }
    } catch {
      data = null;
    }
    this.drawCache = { at: Date.now(), data };
    return data;
  }

  /** Public marketing numbers for the offered vault. avgApr is last month's payouts annualised over TVL (what savers actually earned on average); maxApr is Ample's best-case ceiling. */
  async publicStats() {
    const v: any = (await this.listVaults())[0];
    if (!v) return null;
    const tvl = Number(v.tvlUsd) || 0;
    const monthly = Number(v.payouts?.monthlyUsd) || 0;
    const draw = await this.nextDraw();
    return {
      vaultId: v.id as string,
      symbol: (v.token?.symbol as string) ?? 'USDC',
      decimals: (v.token?.decimals as number) ?? 6,
      tvlUsd: tvl,
      monthlyPayoutsUsd: monthly,
      totalPaidUsd: Number(v.payouts?.cumulativeUsd) || 0,
      avgApr: tvl > 0 ? Math.round(((monthly * 12) / tvl) * 1000) / 10 : null,
      maxApr: Number(v.aprRange?.max) || null,
      nextDrawAt: draw?.nextDrawAt ?? null,
      drawIntervalSeconds: draw?.drawIntervalSeconds ?? null,
      lastDrawStatus: draw?.lastDrawStatus ?? null,
    };
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
      ...(await this.earnings(userId, bal.filter(b => (b?.network ?? '').toUpperCase() === NETWORK))),
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

  // ---- earnings ledger (stake_events) ----

  /**
   * Records one confirmed stake / withdraw / claim. The caller reports the event after its own tx polling; we only store it
   * if Ample's tx status says SUCCESS, and the signature is unique so repeats are no-ops. The amount is self-reported, but the
   * ledger only drives the caller's own stats (never money), and earnings() sanity-checks it against the real balance.
   */
  async recordEvent(
    userId: string,
    e: { kind: 'deposit' | 'withdraw' | 'claim'; vaultId: string; amountBase: string; txSignature: string; payoutId?: string },
  ) {
    const st: any = await this.txStatus(userId, e.txSignature);
    if (String(st?.status ?? '').toUpperCase() !== 'SUCCESS') return { recorded: false, reason: 'not_confirmed' };
    const link = await this.getLink(userId);
    if (!link.linked || !link.walletAddress) return { recorded: false, reason: 'not_linked' };
    const { error } = await this.supabase.getClient().from('stake_events').insert({
      privy_user_id: userId,
      wallet_address: link.walletAddress,
      vault_id: e.vaultId,
      kind: e.kind,
      amount_base: e.amountBase,
      tx_signature: e.txSignature,
      payout_id: e.kind === 'claim' ? e.payoutId ?? null : null,
    });
    if (error && error.code !== '23505') {
      this.logger.warn(`stake_events insert failed: ${error.message}`);
      return { recorded: false, reason: 'db_error' };
    }
    return { recorded: true };
  }

  /**
   * Total won (sum of claimed prizes) and a personal APY from the ledger. APY = winnings / dollar-years held, where the
   * balance steps up on deposits and claims (claims compound) and down on withdrawals. Only reported after a full week
   * and only when the ledger agrees with the real vault balance, otherwise null so we never show a wrong number.
   */
  private async earnings(userId: string, balances: any[]) {
    const none = { totalWonBase: null as string | null, yourApy: null as number | null, trackedSince: null as string | null };
    try {
      const { data, error } = await this.supabase.getClient()
        .from('stake_events').select('kind, amount_base, created_at')
        .eq('privy_user_id', userId).order('created_at', { ascending: true }).limit(5000);
      if (error || !data?.length) return none;
      let won = 0n, bal = 0n;
      let dollarMs = 0, last = new Date(data[0].created_at).getTime();
      const dec = Number((balances[0]?.token?.decimals as number) ?? 6);
      const scale = 10 ** dec;
      for (const r of data) {
        const t = new Date(r.created_at).getTime();
        dollarMs += (Number(bal) / scale) * (t - last);
        last = t;
        const a = BigInt(String(r.amount_base).split('.')[0] || '0');
        if (r.kind === 'deposit') bal += a;
        else if (r.kind === 'claim') { bal += a; won += a; }
        else { bal = bal > a ? bal - a : 0n; }
      }
      const now = Date.now();
      dollarMs += (Number(bal) / scale) * (now - last);
      const spanMs = now - new Date(data[0].created_at).getTime();
      const actual = balances.reduce((acc, b) => acc + (/^\d+$/.test(String(b?.depositsToken ?? '')) ? BigInt(b.depositsToken) : 0n), 0n);
      const agrees = actual > 0n ? Math.abs(Number(bal - actual)) / Number(actual) < 0.05 : bal === 0n;
      const dollarYears = dollarMs / (365 * 24 * 3600 * 1000);
      const apy = spanMs >= 7 * 24 * 3600 * 1000 && agrees && dollarYears > 0
        ? Math.round(((Number(won) / scale) / dollarYears) * 1000) / 10
        : null;
      return { totalWonBase: won.toString(), yourApy: apy, trackedSince: data[0].created_at as string };
    } catch (e: any) {
      this.logger.warn(`earnings failed: ${e?.message}`);
      return none;
    }
  }
}
