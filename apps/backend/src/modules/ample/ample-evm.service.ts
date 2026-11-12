import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { AmpleService, Tier, drawDetails } from './ample.service';

/** Base mainnet, where the larger USDC pool lives. */
export const BASE_CHAIN_ID = 8453;
export const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const NETWORK = 'EVM';
/** $1, same floor as the Solana side. */
const MIN_DEPOSIT = 1_000_000n;

/**
 * The same Ample partner API as AmpleService, for the EVM pool (USDC on Base).
 *
 * An Ample partner user is linked to ONE wallet on ONE network, and linking another wallet rotates it. Solana users already
 * live under their plain Privy id, so the EVM side uses its own partner user id (`evm:<privy id>`). That way an EVM link
 * never hides or replaces a Solana position, and nothing about the Solana flow changes.
 *
 * Ample cannot fund an EVM vault from a Solana-held token through the partner API (it works in their own app only), so the
 * USDC has to be on Base first. Deposits from USDC already on Base are a direct route: one transaction, no routing fee.
 */
@Injectable()
export class AmpleEvmService {
  private readonly logger = new Logger(AmpleEvmService.name);

  constructor(
    private readonly ample: AmpleService,
    private readonly supabase: SupabaseService,
  ) {}

  /** The partner user id Ample knows this person's EVM wallet under. */
  private key(userId: string): string {
    return `evm:${userId}`;
  }

  private session(userId: string): Tier {
    return { kind: 'session', userId: this.key(userId) };
  }

  // ---- tier 1 ----

  async getLink(userId: string): Promise<{ linked: boolean; walletAddress?: string }> {
    try {
      const u: any = await this.ample.request('GET', `/users/${encodeURIComponent(this.key(userId))}`, { kind: 'key' });
      if (u?.walletNetwork && String(u.walletNetwork).toUpperCase() !== NETWORK) return { linked: false };
      return { linked: true, walletAddress: u?.walletAddress };
    } catch (e: any) {
      if (e?.status === 404) return { linked: false };
      throw e;
    }
  }

  challenge(userId: string, walletAddress: string) {
    return this.ample.request('POST', `/users/${encodeURIComponent(this.key(userId))}/challenge`, { kind: 'key' }, { body: { walletAddress } });
  }

  async link(userId: string, walletAddress: string, message: string, signature: string) {
    const out: any = await this.ample.request('POST', '/users', { kind: 'key' }, { body: { partnerUserId: this.key(userId), walletAddress, message, signature } });
    this.ample.forgetSession(this.key(userId));
    return { walletAddress: out?.walletAddress, walletNetwork: out?.walletNetwork };
  }

  // ---- vault ----

  /** The USDC vault on Base. Null if Ample ever disables it, so callers can say "not available" instead of failing. */
  async vault(): Promise<any | null> {
    const all = await this.ample.everyVault().catch(() => [] as any[]);
    return all.find(v =>
      String(v?.network ?? '').toUpperCase() === NETWORK &&
      Number(v?.chainId) === BASE_CHAIN_ID &&
      String(v?.token?.symbol ?? '').toUpperCase() === 'USDC' &&
      String(v?.status ?? '').toUpperCase() === 'ENABLED',
    ) ?? null;
  }

  private async requireVault() {
    const v = await this.vault();
    if (!v) throw new BadRequestException('Earn on Base is not available right now. Try again in a moment.');
    return v;
  }

  async status(userId: string) {
    if (!this.ample.isEnabled()) return { enabled: false, canTransact: false, linked: false, vault: null };
    const [link, vault] = await Promise.all([this.getLink(userId), this.vault()]);
    return { enabled: true, canTransact: this.ample.canBuildTransactions(), ...link, vault };
  }

  /** Public numbers for the Base pool, same shape as the Solana stats so the page can swap between them. */
  async stats() {
    const v = await this.vault();
    if (!v) return null;
    const tvl = Number(v.tvlUsd) || 0;
    const monthly = Number(v.payouts?.monthlyUsd) || 0;
    let draw: any = null;
    try {
      draw = await this.ample.request('GET', '/draws/next', { kind: 'key' }, { query: { network: NETWORK } });
    } catch { /* stats still render without the draw time */ }
    const everyVault = await this.ample.everyVault().catch(() => [] as any[]);
    const evmTvl = everyVault.filter(x => String(x?.network ?? '').toUpperCase() === NETWORK).reduce((a, x) => a + (Number(x?.tvlUsd) || 0), 0);
    const evmMonthly = everyVault.filter(x => String(x?.network ?? '').toUpperCase() === NETWORK).reduce((a, x) => a + (Number(x?.payouts?.monthlyUsd) || 0), 0);
    return {
      vaultId: v.id as string,
      symbol: 'USDC',
      decimals: (v.token?.decimals as number) ?? 6,
      // Everyone saving on this network shares one draw, so the headline size and the odds use the whole network, not one vault.
      tvlUsd: evmTvl || tvl,
      monthlyPayoutsUsd: monthly,
      // Everything the whole EVM pool paid last month (it is one draw across every EVM vault), for a weekly estimate.
      poolMonthlyUsd: Math.round(evmMonthly * 100) / 100,
      // Everything Ample has paid out, every vault on every network (what its own site shows).
      totalPaidUsd: everyVault.reduce((a, x) => a + (Number(x?.payouts?.cumulativeUsd) || 0), 0) || Number(v.payouts?.cumulativeUsd) || 0,
      avgApr: tvl > 0 ? Math.round(((monthly * 12) / tvl) * 1000) / 10 : null,
      maxApr: Number(v.aprRange?.max) || null,
      nextDrawAt: draw?.nextDrawAt ?? null,
      drawIntervalSeconds: draw?.drawIntervalSeconds ?? null,
      lastDrawStatus: draw?.lastDrawStatus ?? null,
      ...drawDetails(draw),
      lastDraw: await this.ample.lastDraw(NETWORK),
    };
  }

  // ---- tier 2 (per-user session) ----

  async overview(userId: string) {
    const t = this.session(userId);
    const q = { network: NETWORK };
    const [tickets, balances, streak, claimable, boosts] = await Promise.all([
      this.ample.request('GET', '/me/tickets', t, { query: q }),
      this.ample.request('GET', '/me/balances', t),
      this.ample.request('GET', '/me/streak', t, { query: q }),
      this.ample.request('GET', '/me/payouts/claimable', t, { query: { ...q, limit: '50' } }),
      this.ample.request('GET', '/me/boosts', t, { query: q }).catch(() => null),
    ]);
    const rows: any[] = (Array.isArray(balances) ? balances : balances?.data ?? []).filter((b: any) => String(b?.network ?? '').toUpperCase() === NETWORK);
    // Ample reports each position's dollar value, so no price lookup is needed here.
    const positions = rows.map((b: any) => ({ ...b, usdMicro: Number(b?.depositsUsd) > 0 ? String(Math.round(Number(b.depositsUsd) * 1e6)) : '0' }));
    const claimRaw: any[] = Array.isArray(claimable) ? claimable : claimable?.data ?? [];
    // A prize is paid in the token of the vault that won it. Price it from that vault, never assume USDC.
    const vaults = await this.ample.everyVault().catch(() => [] as any[]);
    const ctx = { vaults, balances: rows };
    const claimList = await Promise.all(claimRaw.map(async (p: any) => {
      const vaultId = this.ample.payoutVaultId(p, vaults);
      return { ...p, vaultId, usdMicro: (await this.ample.usdMicro(vaultId ?? undefined, String(p.payoutAmount ?? '0'), ctx))?.toString() ?? null };
    }));
    return { tickets, balances: positions, streak, boosts, claimable: claimList };
  }

  private requireAmount(amount: string): bigint {
    let n = 0n;
    try { n = BigInt(amount); } catch { /* not a number */ }
    if (n < MIN_DEPOSIT) throw new BadRequestException('The minimum is $1.');
    return n;
  }

  /**
   * Ample's quote for putting USDC that is already on Base into the vault: an optional ERC-20 approval, then one transaction.
   * The wallet signing it is always the linked wallet (Ample derives the funding address from the session, never from a field).
   */
  async buildDeposit(userId: string, amount: string) {
    this.ample.assertCanTransact();
    this.requireAmount(amount);
    const v = await this.requireVault();
    return this.ample.request('POST', '/tx/deposit/quote', this.session(userId), {
      body: { vaultId: v.id, fromChainId: BASE_CHAIN_ID, fromTokenAddress: BASE_USDC, fromAmount: amount },
    });
  }

  async buildWithdraw(userId: string, amount: string) {
    this.ample.assertCanTransact();
    const v = await this.requireVault();
    const body = (a: string) => ({ vaultId: v.id, amount: a });
    try {
      return await this.ample.request('POST', '/tx/withdraw', this.session(userId), { body: body(amount) });
    } catch (e: any) {
      // The shown balance can sit a hair above what the vault releases. Ample names the real maximum in the error.
      const code = e?.getResponse?.()?.code;
      const max = /at most (\d+)/.exec(String(e?.getResponse?.()?.message ?? ''))?.[1];
      if (code !== 'AMPLE_WITHDRAW_EXCEEDS_POSITION' || !max || BigInt(max) <= 0n || BigInt(max) >= BigInt(amount)) throw e;
      this.logger.warn(`evm withdraw ${amount} exceeds position, retrying with ${max}`);
      return this.ample.request('POST', '/tx/withdraw', this.session(userId), { body: body(max) });
    }
  }

  /**
   * Claim payouts on Base. The response's `transaction.value` carries the cross-chain messaging fee in ETH and must be sent as
   * is, and `authorization`, when present, is a first transaction that has to be sent before the claim.
   */
  buildClaim(userId: string, payoutIds: string[]) {
    this.ample.assertCanTransact();
    return this.ample.request('POST', '/tx/claim', this.session(userId), { body: { payoutIds, sourceChainId: BASE_CHAIN_ID } });
  }

  txStatus(userId: string, hash: string, opts: { toChainId?: string; requestId?: string } = {}) {
    return this.ample.request('GET', `/tx/${encodeURIComponent(hash)}/status`, this.session(userId), {
      query: { fromChainId: String(BASE_CHAIN_ID), toChainId: opts.toChainId, requestId: opts.requestId },
    });
  }

  // ---- earnings ledger (shared stake_events table) ----

  /** Same rules as the Solana ledger: stored only if Ample says the transaction succeeded, once per hash. */
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
      this.logger.warn(`stake_events insert failed (evm): ${error.message}`);
      return { recorded: false, reason: 'db_error' };
    }
    return { recorded: true };
  }
}
