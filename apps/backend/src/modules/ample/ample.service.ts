import { BadRequestException, HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { fetchSolPriceUsd } from '@/common/magicblock-private-transfer';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { SolanaSponsorService } from '@/modules/claims/solana-sponsor.service';
import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
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

  private everyVaultCache: { at: number; data: any[] } | null = null;

  /** Every vault Ample lists, on every network. Used for the headline numbers, never for building transactions. */
  async everyVault(): Promise<any[]> {
    if (this.everyVaultCache && Date.now() - this.everyVaultCache.at < 120_000) return this.everyVaultCache.data;
    const res = await this.call('GET', '/vaults', { kind: 'key' }, { query: { limit: '100' } });
    const data: any[] = Array.isArray(res) ? res : res?.data ?? [];
    this.everyVaultCache = { at: Date.now(), data };
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

  private recentCache: { at: number; data: { amountUsd: number; wallet: string; at: string }[] } | null = null;

  /**
   * Prizes our own users really claimed in the last 60 days (from the stake_events ledger), biggest first, wallets shortened.
   * Only Loofta users are covered, which is exactly what the page says. Cached 5 minutes.
   */
  async recentPayouts() {
    if (this.recentCache && Date.now() - this.recentCache.at < 300_000) return this.recentCache.data;
    let out: { amountUsd: number; wallet: string; at: string }[] = [];
    try {
      const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
      const { data } = await this.supabase.getClient().from('stake_events')
        .select('wallet_address, vault_id, amount_base, created_at').eq('kind', 'claim').gte('created_at', since)
        .order('created_at', { ascending: false }).limit(500);
      const vaults = await this.allVaults().catch(() => [] as any[]);
      const rows: { amountUsd: number; wallet: string; at: string }[] = [];
      for (const r of data ?? []) {
        const micro = await this.usdMicro(r.vault_id, String(r.amount_base).split('.')[0], { vaults, balances: [] });
        const usd = micro === null ? 0 : Number(micro) / 1e6;
        const w = String(r.wallet_address ?? '');
        if (usd >= 0.01 && w.length > 8) rows.push({ amountUsd: Math.round(usd * 100) / 100, wallet: `${w.slice(0, 4)}...${w.slice(-4)}`, at: r.created_at });
      }
      out = rows.sort((a, b) => b.amountUsd - a.amountUsd).slice(0, 12);
    } catch (e: any) {
      this.logger.warn(`recent payouts failed: ${e?.message}`);
    }
    this.recentCache = { at: Date.now(), data: out };
    return out;
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
    // Prizes paid out by Ample in total, every vault on every network (what its own site shows).
    const allPaid = (await this.everyVault().catch(() => [] as any[])).reduce((a, x) => a + (Number(x?.payouts?.cumulativeUsd) || 0), 0);
    return {
      vaultId: v.id as string,
      symbol: (v.token?.symbol as string) ?? 'USDC',
      decimals: (v.token?.decimals as number) ?? 6,
      tvlUsd: tvl,
      monthlyPayoutsUsd: monthly,
      totalPaidUsd: allPaid || Number(v.payouts?.cumulativeUsd) || 0,
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

  async buildDeposit(userId: string, vaultId: string, amount: string, plain = false) {
    this.requireTx();
    let tx: any;
    try {
      tx = await this.call('POST', '/tx/deposit/quote', { kind: 'session', userId }, { body: { vaultId, fromAmount: amount } });
    } catch (e: any) {
      if (e?.getResponse?.()?.code === 'AMPLE_SIMULATION_FAILED') throw await this.explainQuoteFailure(userId, amount, e);
      throw e;
    }
    // Only real USDC stakes of $1 or more are sponsored, so a loop of dust deposits cannot be used to burn the fee payer's SOL.
    const vault = (await this.listVaults().catch(() => [] as any[])).find(v => v?.id === vaultId);
    let big = false;
    try { big = BigInt(amount) >= 1_000_000n; } catch { /* not a number */ }
    const final: any = await this.sponsorFee(userId, tx, !plain && vault?.token?.address === USDC_MINT && big);
    return this.checkedOnChain(userId, tx, final, amount);
  }

  /**
   * Ample simulates the deposit itself when it builds the quote and answers "no program logs" when the wallet cannot fund it.
   * Looks up the wallet it linked, writes its real balances to the log and turns the error into something the user can act on.
   */
  private async explainQuoteFailure(userId: string, amount: string, original: any) {
    let wallet = 'unknown';
    let sol = -1;
    let usdc = -1n;
    try {
      const link = await this.getLink(userId);
      if (link.walletAddress) {
        wallet = link.walletAddress;
        const conn = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
        const owner = new PublicKey(wallet);
        sol = await conn.getBalance(owner).catch(() => -1);
        usdc = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner)).then(r => BigInt(r.value.amount)).catch(() => 0n);
      }
    } catch { /* diagnosis only */ }
    this.logger.warn(`deposit quote rejected user=${userId} wallet=${wallet} sol=${sol} usdc=${usdc} requested=${amount}`);
    let message = 'This deposit could not be prepared. Please try again in a moment.';
    try {
      if (usdc >= 0n && usdc < BigInt(amount)) message = `Your Loofta wallet holds $${(Number(usdc) / 1e6).toFixed(2)} USDC, which is less than the $${(Number(amount) / 1e6).toFixed(2)} you are adding.`;
      else if (sol >= 0 && sol < 3_000_000) message = 'Your first deposit needs a one-time account setup fee. Press Add again and approve the setup step.';
    } catch { /* keep generic message */ }
    return new HttpException({ statusCode: 400, code: 'AMPLE_SIMULATION_FAILED', message, wallet, sol, usdc: usdc.toString() }, 400);
  }

  private setupToday = new Map<string, { day: string; n: number }>();
  private setupGlobal = { day: '', n: 0 };

  /**
   * One-time account setup for a wallet with no SOL. Opening the savings account needs about 0.002 SOL of rent and a brand new
   * Loofta wallet holds none, and Ample refuses to build the deposit until it can pass its own simulation. This builds a single
   * transaction that we construct completely ourselves: the user sends a small USDC amount to the Loofta fee wallet and the fee
   * wallet sends the SOL to the user, atomically. It is priced, not free (the USDC covers the SOL at the live price plus 5%), so
   * repeating it for farming costs the caller more than it costs us. The destination is always the user's linked wallet, never a
   * request field, and it is only offered while the wallet is below the rent amount, so it cannot be used to top a wallet up.
   */
  /**
   * Works out whether this wallet needs the one-time setup and what it costs. Null when it does not. The fee is what the SOL
   * costs at the live price (STAKE_SETUP_LAMPORTS, about 0.0021 SOL) plus a $0.05 margin, never below $0.17.
   */
  private async setupQuote(userId: string) {
    const kp = this.solanaSponsor.getFeePayerKeypair();
    const feeWallet = this.solanaSponsor.getFeePayerAddress();
    const link = await this.getLink(userId);
    if (!kp || !feeWallet || !link.walletAddress) return null;
    const user = new PublicKey(link.walletAddress);
    const conn = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
    // What a first deposit really needs, read from the chain: the rent of the new token account, plus the minimum a wallet must keep
    // when it still holds SOL (an empty system account), plus headroom for the network and priority fee (about 80,000 on real deposits).
    let target: bigint;
    const override = Number(this.config.get<string>('STAKE_SETUP_LAMPORTS') ?? 0);
    if (override > 0) target = BigInt(override);
    else {
      const [tokenRent, emptyRent] = await Promise.all([conn.getMinimumBalanceForRentExemption(165), conn.getMinimumBalanceForRentExemption(0)]);
      target = BigInt(Math.ceil((tokenRent + emptyRent + 150_000) / 10_000) * 10_000);
    }
    const sol = await conn.getBalance(user).catch(() => -1);
    if (sol < 0 || BigInt(sol) >= target) return null;
    const lamports = target - BigInt(sol); // top up to the target, so a wallet that already got part of it only pays for the rest
    // The rent is paid once, when the savings account is opened. Anyone who already holds a position has it, and their wallet is
    // back near zero SOL after that, so the SOL check alone would charge them again on every deposit.
    const held: any = await this.call('GET', '/me/balances', { kind: 'session', userId }).catch(() => null);
    const rows: any[] = Array.isArray(held) ? held : held?.data ?? [];
    if (rows.some((b: any) => (b?.network ?? '').toUpperCase() === NETWORK && Number(b?.depositsToken) > 0)) return null;

    const price = await fetchSolPriceUsd().catch(() => 0);
    if (!price || price <= 0) throw new BadRequestException('Could not price the account setup right now. Try again in a moment.');
    let feeUsdc = BigInt(Math.ceil((Number(lamports) / 1e9) * price * 1e6));
    if (feeUsdc < 170_000n) feeUsdc = 170_000n;
    feeUsdc += 50_000n;
    if (feeUsdc > 900_000n) throw new BadRequestException('Account setup is not available right now. Try again later.');
    return { kp, feeWallet, link, lamports, user, conn, sol, feeUsdc };
  }

  /** Lets the page show the first-time deposit fee before the user taps anything. */
  async setupFee(userId: string) {
    const q = await this.setupQuote(userId).catch(() => null);
    return q ? { needed: true as const, feeUsd: Number(q.feeUsdc) / 1e6 } : { needed: false as const };
  }

  async buildSetup(userId: string, amount: string) {
    this.requireTx();
    const q = await this.setupQuote(userId);
    if (!q) return { needed: false as const };
    const { kp, feeWallet, link, lamports, user, conn, sol, feeUsdc } = q;

    const mint = new PublicKey(USDC_MINT);
    const from = getAssociatedTokenAddressSync(mint, user);
    const to = getAssociatedTokenAddressSync(mint, new PublicKey(feeWallet));
    if (!(await conn.getAccountInfo(to))) throw new BadRequestException('Account setup is not available right now. Try again later.');
    const usdc = await conn.getTokenAccountBalance(from).then(r => BigInt(r.value.amount)).catch(() => 0n);
    let want = 0n;
    try { want = BigInt(amount); } catch { /* ignore */ }
    if (usdc < feeUsdc + want) {
      const need = Number(feeUsdc + want) / 1e6;
      throw new BadRequestException(`You need $${need.toFixed(2)} in your wallet: $${(Number(want) / 1e6).toFixed(2)} to add plus the one-time $${(Number(feeUsdc) / 1e6).toFixed(2)} first-time deposit fee.`);
    }

    const day = new Date().toISOString().slice(0, 10);
    const cur = this.setupToday.get(userId);
    const n = cur?.day === day ? cur.n : 0;
    const g = this.setupGlobal.day === day ? this.setupGlobal.n : 0;
    if (n >= 3 || g >= 300) { this.logger.warn(`account setup skipped: daily cap user=${userId}`); throw new BadRequestException('Account setup is not available right now. Try again later.'); }
    if (Date.now() - this.payerBalance.at > 60_000) this.payerBalance = { at: Date.now(), lamports: await conn.getBalance(kp.publicKey) };
    if (this.payerBalance.lamports < 100_000_000) { this.logger.warn('account setup skipped: fee payer balance below 0.1 SOL'); throw new BadRequestException('Account setup is not available right now. Try again later.'); }

    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: kp.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        createTransferCheckedInstruction(from, mint, to, user, feeUsdc, 6),
        SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: user, lamports }),
      ],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([kp]);
    this.setupToday.set(userId, { day, n: n + 1 });
    this.setupGlobal = { day, n: g + 1 };
    this.logger.log(`account setup user=${userId} wallet=${link.walletAddress} sol=${sol} fee=${feeUsdc} lamports=${lamports}`);
    return {
      needed: true as const,
      feeUsd: Number(feeUsdc) / 1e6,
      network: 'SOLANA',
      transaction: { chainId: 101, encoding: 'base64' as const, unsigned: Buffer.from(tx.serialize()).toString('base64') },
      expiresAt: new Date(Date.now() + 45_000).toISOString(),
    };
  }

  private async simulate(conn: Connection, b64: string): Promise<string | null> {
    try {
      const sim = await conn.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(b64, 'base64')), { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
      if (!sim.value.err) return null;
      const last = (sim.value.logs ?? []).slice(-3).join(' | ');
      return `${JSON.stringify(sim.value.err)}${last ? ` :: ${last}` : ' :: no program logs'}`;
    } catch (e: any) {
      return `simulation unavailable: ${e?.message}`;
    }
  }

  /**
   * Tests the deposit against the chain before it reaches the user's wallet and writes the real reason to the log. If the
   * sponsored version fails but the plain one works, the plain one is returned. The result carries the user's SOL and USDC
   * balances and both errors so the page can say exactly what is wrong instead of a generic "would fail".
   */
  private async checkedOnChain(userId: string, original: any, final: any, amount: string) {
    try {
      const link = await this.getLink(userId);
      if (!link.walletAddress || !original?.transaction?.unsigned) return final;
      const conn = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
      const user = new PublicKey(link.walletAddress);
      const [lamports, usdc, plainErr] = await Promise.all([
        conn.getBalance(user).catch(() => -1),
        conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), user)).then(r => r.value.amount).catch(() => '0'),
        this.simulate(conn, original.transaction.unsigned),
      ]);
      const finalErr = final.sponsored ? await this.simulate(conn, final.transaction.unsigned) : plainErr;
      const diag = { sol: lamports, usdc, plainErr, finalErr, sponsored: !!final.sponsored, requested: amount };
      if (plainErr || finalErr) this.logger.warn(`deposit check user=${userId} wallet=${link.walletAddress} ${JSON.stringify(diag)}`);
      if (final.sponsored && finalErr && !plainErr) return { ...original, diag };
      return { ...final, diag };
    } catch (e: any) {
      this.logger.warn(`deposit check failed: ${e?.message}`);
      return final;
    }
  }

  private sponsoredToday = new Map<string, { day: string; n: number }>();
  private sponsoredGlobal = { day: '', n: 0 };
  private payerBalance = { at: 0, lamports: 0 };

  /**
   * Gasless staking: Loofta pays the Solana network fee, the user still pays for anything Ample's own instructions charge them
   * (token amounts, account rent). Safe by construction: we only sign a transaction we built ourselves from Ample's response for
   * the user's own linked wallet, and only when the fee payer is NOT referenced by any instruction (so it can pay the fee and
   * nothing else, never a transfer or rent). Fee payer signature covers the message, so the client cannot alter it afterwards.
   * Capped per user per day as a speed bump. Fails open: on any doubt the plain transaction is returned and the user pays the fee.
   */
  private async sponsorFee(userId: string, tx: any, eligible = true) {
    if (!eligible) return tx;
    try {
      const kp = this.solanaSponsor.getFeePayerKeypair();
      const link = await this.getLink(userId);
      if (!kp || !link.walletAddress || !tx?.transaction?.unsigned) { this.logger.warn(`fee sponsorship skipped: no fee payer key / wallet / tx`); return tx; }
      const day = new Date().toISOString().slice(0, 10);
      const cur = this.sponsoredToday.get(userId);
      const n = cur?.day === day ? cur.n : 0;
      if (n >= 30) { this.logger.warn(`fee sponsorship skipped: user daily cap`); return tx; }
      const g = this.sponsoredGlobal.day === day ? this.sponsoredGlobal.n : 0;
      if (g >= 3000) { this.logger.warn(`fee sponsorship skipped: global daily cap`); return tx; } // global daily ceiling, about 0.03 SOL of network fees

      const user = new PublicKey(link.walletAddress);
      const conn = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
      const vtx = VersionedTransaction.deserialize(Buffer.from(tx.transaction.unsigned, 'base64'));
      if (vtx.message.header.numRequiredSignatures !== 1 || !vtx.message.staticAccountKeys[0].equals(user)) { this.logger.warn(`fee sponsorship skipped: unexpected signers or payer in Ample tx`); return tx; }
      const tables = (await Promise.all(vtx.message.addressTableLookups.map(async l => (await conn.getAddressLookupTable(l.accountKey)).value)))
        .filter((t): t is NonNullable<typeof t> => !!t);
      if (tables.length !== vtx.message.addressTableLookups.length) { this.logger.warn(`fee sponsorship skipped: lookup tables missing`); return tx; }

      const msg = TransactionMessage.decompile(vtx.message, { addressLookupTableAccounts: tables });
      const sponsorKey = kp.publicKey;
      // Stop sponsoring when the fee payer drops under 0.1 SOL, so staking can never starve the other features that rely on it.
      if (Date.now() - this.payerBalance.at > 60_000) this.payerBalance = { at: Date.now(), lamports: await conn.getBalance(sponsorKey) };
      if (this.payerBalance.lamports < 100_000_000) { this.logger.warn(`fee sponsorship skipped: fee payer balance below 0.1 SOL`); return tx; }
      // Bound the fee: refuse transactions carrying a large compute-unit price (priority fee), signatures are already limited to two.
      const CB = 'ComputeBudget111111111111111111111111111111';
      let price = 0n;
      let limit = 200_000n;
      for (const ix of msg.instructions) {
        if (ix.programId.toBase58() !== CB) continue;
        if (ix.data[0] === 3) price = ix.data.readBigUInt64LE(1);
        if (ix.data[0] === 2) limit = BigInt(ix.data.readUInt32LE(1));
      }
      if ((price * limit) / 1_000_000n > 20_000n) { this.logger.warn(`fee sponsorship skipped: priority fee too high`); return tx; }
      const touchesSponsor = msg.instructions.some(ix => ix.programId.equals(sponsorKey) || ix.keys.some(k => k.pubkey.equals(sponsorKey)));
      if (touchesSponsor) { this.logger.warn(`fee sponsorship skipped: fee payer referenced by instruction`); return tx; }

      const out = new VersionedTransaction(
        new TransactionMessage({ payerKey: sponsorKey, recentBlockhash: msg.recentBlockhash, instructions: msg.instructions }).compileToV0Message(tables),
      );
      out.sign([kp]);
      const bytes = out.serialize();
      if (bytes.length > 1232) { this.logger.warn(`fee sponsorship skipped: transaction too large`); return tx; }
      this.sponsoredToday.set(userId, { day, n: n + 1 });
      this.sponsoredGlobal = { day, n: g + 1 };
      return { ...tx, transaction: { ...tx.transaction, unsigned: Buffer.from(bytes).toString('base64') }, sponsored: true };
    } catch (e: any) {
      this.logger.warn(`fee sponsorship skipped: ${e?.message}`);
      return tx;
    }
  }

  /** Withdrawal fee in basis points (default 0.10%, capped at $25 per withdrawal). Set STAKE_WITHDRAW_FEE_BPS=0 to switch off. */
  get withdrawFeeBps(): number {
    const raw = Number(this.config.get<string>('STAKE_WITHDRAW_FEE_BPS') ?? 10);
    return Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 0), 100) : 10;
  }

  async buildWithdraw(userId: string, vaultId: string, amount: string, plain = false) {
    this.requireTx();
    let tx: any;
    try {
      tx = await this.call('POST', '/tx/withdraw', { kind: 'session', userId }, { body: { vaultId, amount } });
    } catch (e: any) {
      // The displayed balance can be a hair above what Ample lets the user withdraw (rounding / accrual timing).
      // Ample states the real maximum in the error, so retry once with it instead of failing the withdrawal.
      const code = e?.getResponse?.()?.code;
      const max = /at most (\d+)/.exec(String(e?.getResponse?.()?.message ?? ''))?.[1];
      if (code !== 'AMPLE_WITHDRAW_EXCEEDS_POSITION' || !max || BigInt(max) <= 0n || BigInt(max) >= BigInt(amount)) throw e;
      this.logger.warn(`withdraw ${amount} exceeds position, retrying with ${max}`);
      amount = max;
      tx = await this.call('POST', '/tx/withdraw', { kind: 'session', userId }, { body: { vaultId, amount } });
    }
    const vault = (await this.listVaults().catch(() => [] as any[])).find(v => v?.id === vaultId);
    if (!vault || this.withdrawFeeBps <= 0) return { ...tx, fee: null, withdrawnBase: amount };
    const withFee: any = await this.withFee(userId, tx, amount);
    // Sponsored only when the exit fee is actually in the transaction and is worth more than the network fee we pay (about $1+),
    // so dust withdrawals cannot be looped for free. Prize-token vaults are never sponsored.
    let big = false;
    try { big = BigInt(amount) >= 1_000_000n; } catch { /* not a number */ }
    const paid = !plain && !!withFee.fee && big && vault?.token?.address === USDC_MINT;
    return { ...(await this.sponsorFee(userId, withFee, paid)), withdrawnBase: amount };
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
      let fee = (BigInt(amountBase) * BigInt(this.withdrawFeeBps)) / 10000n;
      if (fee > 25_000_000n) fee = 25_000_000n; // never more than $25 per withdrawal
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
  async buildClaim(userId: string, payoutId: string, plain = false) {
    this.requireTx();
    const tx: any = await this.call('POST', '/tx/claim', { kind: 'session', userId }, { body: { payoutIds: [payoutId], sourceChainId: 101 } });
    return this.sponsorFee(userId, tx, !plain);
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
