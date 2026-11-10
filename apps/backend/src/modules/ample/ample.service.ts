import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { fetchSolPriceUsd } from '@/common/magicblock-private-transfer';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { SolanaSponsorService } from '@/modules/claims/solana-sponsor.service';
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

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
    private readonly solanaSponsor: SolanaSponsorService,
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

  /** Every Solana vault (USDC, SOL, JupUSD...). Prizes can be paid in any of them, so token info is needed for all. */
  async allVaults(): Promise<any[]> {
    if (this.vaultCache && Date.now() - this.vaultCache.at < 120_000) return this.vaultCache.data;
    const res = await this.call('GET', '/vaults', { kind: 'key' }, { query: { limit: '100' } });
    const rows: any[] = Array.isArray(res) ? res : res?.data ?? [];
    const data = rows.filter(v => (v?.network ?? '').toUpperCase() === NETWORK);
    this.vaultCache = { at: Date.now(), data };
    return data;
  }

  /** Only the Solana USDC vault is on offer ("stake your USDC"); the SOL and JupUSD vaults are not. */
  async listVaults() {
    return (await this.allVaults()).filter(v => v?.token?.symbol === 'USDC');
  }

  // ---- USD conversion (rates cached 2h) ----

  private readonly rateCache = new Map<string, { usdPerToken: number; at: number }>();
  private static readonly RATE_TTL_MS = 2 * 60 * 60 * 1000;

  /**
   * USD value of one whole token of a vault, cached for 2 hours. Learned from the user's own position
   * (Ample's depositsUsd / depositsToken) when they hold one, otherwise stablecoins are $1 and SOL uses the live price.
   */
  private async usdPerToken(vaultId: string, symbol: string | undefined, learned?: number | null): Promise<number | null> {
    const hit = this.rateCache.get(vaultId);
    if (learned && learned > 0) {
      this.rateCache.set(vaultId, { usdPerToken: learned, at: Date.now() });
      return learned;
    }
    if (hit && Date.now() - hit.at < AmpleService.RATE_TTL_MS) return hit.usdPerToken;
    let rate: number | null = null;
    const sym = (symbol ?? '').toUpperCase();
    if (sym === 'SOL') rate = await fetchSolPriceUsd();
    else if (['USDC', 'USDT', 'JUPUSD', 'PYUSD', 'USDS'].includes(sym)) rate = 1;
    if (rate && rate > 0) {
      this.rateCache.set(vaultId, { usdPerToken: rate, at: Date.now() });
      return rate;
    }
    return hit?.usdPerToken ?? null; // stale beats nothing
  }

  private loggedClaimShape = false;

  /** Which vault paid a prize: its own vault id when Ample sends one, otherwise matched by token address or symbol. */
  private payoutVaultId(p: any, vaults: any[]): string | null {
    const direct = p?.vaultId ?? p?.vault?.id;
    if (direct) return String(direct);
    const addr = p?.tokenAddress ?? p?.token?.address;
    const sym = p?.tokenSymbol ?? p?.symbol ?? p?.token?.symbol;
    const hit = (addr && vaults.find(v => v?.token?.address === addr)) || (sym && vaults.find(v => v?.token?.symbol === sym));
    return hit?.id ? String(hit.id) : null;
  }

  /** USD millionths for a raw payout/position amount of the given vault. null when the token cannot be priced. */
  private async usdMicro(vaultId: string | undefined, rawBase: string, ctx: { vaults: any[]; balances: any[] }): Promise<bigint | null> {
    if (!vaultId || !/^\d+$/.test(String(rawBase))) return null;
    const bal = ctx.balances.find(b => b?.vaultId === vaultId);
    const vault = ctx.vaults.find(v => v?.id === vaultId);
    const dec = Number(bal?.token?.decimals ?? vault?.token?.decimals ?? 6);
    const symbol: string | undefined = bal?.token?.symbol ?? vault?.token?.symbol;
    const learned = bal && Number(bal.depositsToken) > 0 && Number(bal.depositsUsd) > 0 ? Number(bal.depositsUsd) / (Number(bal.depositsToken) / 10 ** dec) : null;
    const rate = await this.usdPerToken(vaultId, symbol, learned);
    if (rate === null) return null;
    return BigInt(Math.round((Number(rawBase) / 10 ** dec) * rate * 1e6));
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
    const vaults = await this.allVaults().catch(() => [] as any[]);
    const bal: any[] = (Array.isArray(balances) ? balances : balances?.data ?? []).filter((b: any) => (b?.network ?? '').toUpperCase() === NETWORK);
    const ctx = { vaults, balances: bal };
    // Positions and prizes can sit in several vaults (USDC, SOL, JupUSD). Every one gets a USD value (rates cached 2h)
    // and the token mint, so the page can show one dollar total and convert to USDC through Jupiter on withdrawal.
    const positions = await Promise.all(bal.map(async (b: any) => ({
      ...b,
      tokenMint: vaults.find(v => v?.id === b.vaultId)?.token?.address ?? null,
      usdMicro: (await this.usdMicro(b.vaultId, String(b.depositsToken ?? '0'), ctx))?.toString() ?? null,
    })));
    const claimList: any[] = Array.isArray(claimable) ? claimable : claimable?.data ?? [];
    if (claimList[0] && !this.loggedClaimShape) {
      this.loggedClaimShape = true;
      this.logger.log(`claimable payout fields: ${Object.keys(claimList[0]).join(', ')}`);
    }
    const claimDecorated = await Promise.all(claimList.map(async (p: any) => {
      // A prize is paid in the token of the vault that won it, so the vault must be known to price it. Never guess USDC.
      const vaultId: string | null = this.payoutVaultId(p, vaults);
      return {
        ...p,
        vaultId,
        usdMicro: (await this.usdMicro(vaultId ?? undefined, String(p.payoutAmount ?? '0'), ctx))?.toString() ?? null,
      };
    }));
    return {
      tickets,
      balances: positions,
      streak,
      claimable: claimDecorated,
      withdrawFeeBps: this.withdrawFeeBps,
      ...(await this.earnings(userId, bal, ctx)),
    };
  }

  private requireTx() {
    if (this.txScopeDenied) throw new ServiceUnavailableException('Staking is opening soon');
  }

  async buildDeposit(userId: string, vaultId: string, amount: string) {
    this.requireTx();
    return this.call('POST', '/tx/deposit/quote', { kind: 'session', userId }, { body: { vaultId, fromAmount: amount } });
  }

  /** Withdrawal fee in basis points (default 0.25%, a typical DeFi vault exit fee). Set STAKE_WITHDRAW_FEE_BPS=0 to switch off. */
  get withdrawFeeBps(): number {
    const raw = Number(this.config.get<string>('STAKE_WITHDRAW_FEE_BPS') ?? 25);
    return Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 0), 100) : 25;
  }

  async buildWithdraw(userId: string, vaultId: string, amount: string) {
    this.requireTx();
    const tx: any = await this.call('POST', '/tx/withdraw', { kind: 'session', userId }, { body: { vaultId, amount } });
    const vault = (await this.listVaults().catch(() => [] as any[])).find(v => v?.id === vaultId);
    if (!vault || this.withdrawFeeBps <= 0) return { ...tx, fee: null };
    return this.withFee(userId, tx, amount);
  }

  /**
   * Adds the withdrawal fee to the same transaction the user signs: one extra USDC transfer from their wallet to the Loofta fee
   * wallet, placed after Ample's own instructions so it is paid out of the USDC that was just withdrawn. Fails open: if the
   * transaction cannot be safely extended (size, lookup tables, unexpected signer, missing fee account) the plain withdrawal is
   * returned and no fee is taken, so a withdrawal is never blocked or made unsafe by the fee.
   */
  private async withFee(userId: string, tx: any, amountBase: string) {
    const plain = { ...tx, fee: null };
    try {
      const feeWallet = this.solanaSponsor.getFeePayerAddress();
      const link = await this.getLink(userId);
      if (!feeWallet || !link.walletAddress || !tx?.transaction?.unsigned) return plain;
      const fee = (BigInt(amountBase) * BigInt(this.withdrawFeeBps)) / 10000n;
      if (fee <= 0n) return plain;

      const user = new PublicKey(link.walletAddress);
      const mint = new PublicKey(USDC_MINT);
      const from = getAssociatedTokenAddressSync(mint, user);
      const to = getAssociatedTokenAddressSync(mint, new PublicKey(feeWallet));
      const conn = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
      if (!(await conn.getAccountInfo(to))) return plain;

      const vtx = VersionedTransaction.deserialize(Buffer.from(tx.transaction.unsigned, 'base64'));
      if (vtx.message.header.numRequiredSignatures !== 1 || !vtx.message.staticAccountKeys[0].equals(user)) return plain;
      const tables = (await Promise.all(vtx.message.addressTableLookups.map(async l => (await conn.getAddressLookupTable(l.accountKey)).value)))
        .filter((t): t is NonNullable<typeof t> => !!t);
      if (tables.length !== vtx.message.addressTableLookups.length) return plain;

      const msg = TransactionMessage.decompile(vtx.message, { addressLookupTableAccounts: tables });
      msg.instructions.push(createTransferCheckedInstruction(from, mint, to, user, fee, 6));
      const out = new VersionedTransaction(msg.compileToV0Message(tables));
      const bytes = out.serialize();
      if (bytes.length > 1232) return plain;
      return {
        ...tx,
        transaction: { ...tx.transaction, unsigned: Buffer.from(bytes).toString('base64') },
        fee: { bps: this.withdrawFeeBps, amountBase: fee.toString() },
      };
    } catch (e: any) {
      this.logger.warn(`withdraw fee skipped: ${e?.message}`);
      return plain;
    }
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
  private async earnings(userId: string, balances: any[], ctx: { vaults: any[]; balances: any[] }) {
    const none = { totalWonBase: null as string | null, yourApy: null as number | null, trackedSince: null as string | null };
    try {
      const { data, error } = await this.supabase.getClient()
        .from('stake_events').select('kind, amount_base, created_at, vault_id')
        .eq('privy_user_id', userId).order('created_at', { ascending: true }).limit(5000);
      if (error || !data?.length) return none;
      let won = 0n, bal = 0n;
      let dollarMs = 0, last = new Date(data[0].created_at).getTime();
      const dec = Number((balances[0]?.token?.decimals as number) ?? 6);
      const scale = 10 ** dec;
      const usdcVaultId = (balances.find(b => b?.token?.symbol === 'USDC') ?? balances[0])?.vaultId;
      for (const r of data) {
        const t = new Date(r.created_at).getTime();
        dollarMs += (Number(bal) / scale) * (t - last);
        last = t;
        const a = BigInt(String(r.amount_base).split('.')[0] || '0');
        if (r.kind === 'deposit') bal += a;
        // Claims are stored in the raw token of the vault that paid them. They count as winnings in dollars (2h cached rate),
        // but only a USDC prize adds to the USDC balance.
        else if (r.kind === 'claim') {
          won += (await this.usdMicro(r.vault_id, a.toString(), ctx)) ?? 0n;
          if (r.vault_id === usdcVaultId) bal += a;
        }
        else { bal = bal > a ? bal - a : 0n; }
      }
      const now = Date.now();
      dollarMs += (Number(bal) / scale) * (now - last);
      const spanMs = now - new Date(data[0].created_at).getTime();
      const usdcPos = balances.find(b => b?.vaultId === usdcVaultId);
      const actual = /^\d+$/.test(String(usdcPos?.depositsToken ?? '')) ? BigInt(usdcPos.depositsToken) : 0n;
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
