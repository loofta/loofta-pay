import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  erc20Abi,
  type Address,
  encodeFunctionData,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

// ─── Megapot contract addresses on Base ──────────────────────────────────────
export const MEGAPOT_USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const MEGAPOT_RANDOM_BUYER: Address = '0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd';
export const MEGAPOT_JACKPOT: Address = '0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2';
export const MEGAPOT_TICKET_NFT: Address = '0x48ffe35abb9f4780a4f1775c2ce1c46185b366e4';
export const MEGAPOT_TICKET_PRICE_USDC = 1; // $1 per ticket

// Conservative fallback for getWinClaimFactor when the live on-chain referralWinShare read fails
// after retries — matches the documented ~10% protocol/referral cut (see lottery.service.ts's
// "Megapot applies a ~10% protocol fee" comment) instead of assuming a 0% cut.
const DEFAULT_REFERRAL_WIN_SHARE_FACTOR = 0.9;

const TICKET_NFT_ABI = [
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

const DEFAULT_BASE_RPC = 'https://mainnet.base.org';
const MEGAPOT_API = 'https://api.megapot.io/v1';

export const RANDOM_BUYER_ABI = [
  {
    name: 'buyTickets',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_numTickets', type: 'uint256' },
      { name: '_recipient', type: 'address' },
      { name: '_referrers', type: 'address[]' },
      { name: '_referralSplit', type: 'uint256[]' },
      { name: '_source', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

export const JACKPOT_ABI = [
  {
    name: 'buyTickets',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_numTickets', type: 'uint256' },
      { name: '_recipient', type: 'address' },
      { name: '_referrers', type: 'address[]' },
      { name: '_referralSplit', type: 'uint256[]' },
      { name: '_source', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'claimWinnings',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_userTicketIds', type: 'uint256[]' }],
    outputs: [],
  },
  {
    name: 'referralFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getDrawingState',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_drawingId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'prizePool', type: 'uint256' },
          { name: 'ticketPrice', type: 'uint256' },
          { name: 'edgePerTicket', type: 'uint256' },
          { name: 'referralWinShare', type: 'uint256' },
          { name: 'referralFee', type: 'uint256' },
          { name: 'globalTicketsBought', type: 'uint256' },
          { name: 'lpEarnings', type: 'uint256' },
          { name: 'drawingTime', type: 'uint256' },
          { name: 'winningTicket', type: 'uint256' },
          { name: 'ballMax', type: 'uint8' },
          { name: 'bonusballMax', type: 'uint8' },
          { name: 'payoutCalculator', type: 'address' },
          { name: 'jackpotLock', type: 'bool' },
        ],
      },
    ],
  },
] as const;

// Raw API response shape (snake_case)
export interface MegapotRoundRaw {
  id: string;
  status: string;
  ended_at: string | null;      // draw time
  prize_pool: { amount: string; decimals: number } | null;
  ticket_count?: number;
  winning_numbers?: { normals: number[]; bonusball: number } | null;
}

// Normalized shape used throughout our codebase (camelCase conveniences added)
export interface MegapotRound extends MegapotRoundRaw {
  drawTime: string | null;   // = ended_at
  prizePool: string | null;  // = prize_pool.amount
  ticketsSold: number;       // = ticket_count
}

export interface MegapotTicket {
  id: string;
  wallet: string;
  buyer?: string;
  round_id: string;
  normals: number[];
  bonusball: number;
  matched_normals?: number;
  bonusball_match?: boolean;
  claimed?: boolean;
  claimed_tx_hash?: string | null;
  // legacy camelCase fields (older API versions)
  roundId?: string;
  walletAddress?: string;
  ticketCount?: number;
  createdAt?: string;
}

export interface MegapotWin {
  roundId: string;
  walletAddress: string;
  amount: string;
  tier: number;
  ticketIds: string[];
  txHash?: string;
}

export interface MegapotWalletStats {
  totalTickets: number;
  totalWon: string;
  totalSpent: string;
}

export interface PrizeTierInfo {
  normalMatches: number;
  bonusMatch: boolean;
  grossUsdc: number;
  netUsdc: number;
  ticketCount: number;
}

export interface PrizeTiersSnapshot {
  sourceRoundId: string;
  settledAt: string | null;
  claimFactor: number;
  tiers: PrizeTierInfo[];
}

// The 10 tiers Megapot markets publicly, in their published display order. Two other
// (normalMatches, bonusMatch) combos exist in the raw /rounds/{id} response — (0,false) and
// (1,false) — but those are "matched nothing" non-wins Megapot doesn't list, so they're excluded
// here and any prize_tiers entry not in this set is dropped.
const PUBLIC_TIER_ORDER: Array<{ normalMatches: number; bonusMatch: boolean }> = [
  { normalMatches: 5, bonusMatch: true },
  { normalMatches: 5, bonusMatch: false },
  { normalMatches: 4, bonusMatch: true },
  { normalMatches: 4, bonusMatch: false },
  { normalMatches: 3, bonusMatch: true },
  { normalMatches: 2, bonusMatch: true },
  { normalMatches: 3, bonusMatch: false },
  { normalMatches: 1, bonusMatch: true },
  { normalMatches: 2, bonusMatch: false },
  { normalMatches: 0, bonusMatch: true },
];

/** How many of a ticket's numbers match the drawn winning numbers, for pricing against real prize_tiers payouts. */
export function matchTicketTier(
  ticket: { main: number[]; bonus: number },
  winning: { main: number[]; bonus: number },
): { normalMatches: number; bonusMatch: boolean } {
  const winSet = new Set(winning.main);
  const normalMatches = ticket.main.filter(n => winSet.has(n)).length;
  const bonusMatch = ticket.bonus === winning.bonus;
  return { normalMatches, bonusMatch };
}

@Injectable()
export class MegapotService {
  private readonly logger = new Logger(MegapotService.name);
  private readonly apiKey: string;
  private readonly referrerWallet: Address | null;
  private readonly sourceId: `0x${string}`;
  private prizeTiersCache: { data: PrizeTiersSnapshot; fetchedAt: number } | null = null;
  private static readonly PRIZE_TIERS_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — tiers only change once/day at draw settlement

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('MEGAPOT_API_KEY', '');
    const referrer = this.config.get<string>('MEGAPOT_REFERRER_WALLET', '');
    this.referrerWallet = referrer ? (referrer as Address) : null;
    // bytes32 encoding of "loofta"
    this.sourceId = toHex('loofta', { size: 32 });
  }

  getSourceId(): `0x${string}` { return this.sourceId; }
  getReferrers(): Address[] { return this.referrerWallet ? [this.referrerWallet] : []; }
  getSplits(): bigint[] { return this.referrerWallet ? [1_000_000_000_000_000_000n] : []; }

  // ─── Data API ──────────────────────────────────────────────────────────────

  private async apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${MEGAPOT_API}${path}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Megapot API ${path} returned ${res.status}`);
    return res.json() as Promise<T>;
  }

  private normalizeRound(raw: any): MegapotRound {
    // prize_pool.amount is in base units (decimals, e.g. 6 for USDC) — convert to a dollar value.
    const prizePool = raw.prize_pool?.amount != null
      ? String(Number(raw.prize_pool.amount) / 10 ** (raw.prize_pool.decimals ?? 6))
      : raw.prizePool ?? null;
    return {
      ...raw,
      drawTime: raw.ended_at ?? raw.draw_time ?? raw.drawTime ?? null,
      prizePool,
      ticketsSold: raw.ticket_count ?? raw.ticketsSold ?? 0,
    };
  }

  async getActiveRound(): Promise<MegapotRound> {
    const raw = await this.apiGet<any>('/rounds/active');
    return this.normalizeRound(raw);
  }

  async getWalletTickets(address: string): Promise<MegapotTicket[]> {
    const data = await this.apiGet<{ data: MegapotTicket[] }>(`/wallets/${address}/tickets`);
    return data.data ?? [];
  }

  async getWalletWins(address: string): Promise<MegapotWin[]> {
    const data = await this.apiGet<{ data: MegapotWin[] }>(`/wallets/${address}/wins`);
    return data.data ?? [];
  }

  /**
   * Check if a companion wallet won in a specific round via the Data API. Returns null if no win
   * or wallet not indexed.
   *
   * Real incident: the API's `/wins/rounds/:id` entries nest the payout as
   * `amount: { amount: "1000001", decimals: 6 }`, but this used to read `w.amount` directly and
   * `parseFloat(String({...}))` → `parseFloat("[object Object]")` → `NaN` — every call silently
   * contributed $0, so this always returned null. That broke resolveTicketWin's whole reason for
   * existing (using this as the trusted override when on-chain NFT metadata undercounts) without
   * ever raising an error. Also now captures each win's `user_ticket_id` — verified against real
   * winning tickets to exactly match their on-chain NFT token ID — so this can tell a caller
   * exactly which token(s) to claim instead of them having to guess from unreliable metadata or
   * a possibly-mis-synced `ticket_nft_ids` column.
   */
  async getWalletWinsForRound(
    address: Address,
    roundId: string,
  ): Promise<{ winAmountUsdc: number; tier: number | null; ticketIds: string[] } | null> {
    try {
      const res = await this.apiGet<{ data: any[] }>(`/wallets/${address}/wins/rounds/${roundId}`);
      const wins = res.data ?? [];
      if (!wins.length) return null;

      const parseAmount = (w: any): number => {
        const raw = w.amount;
        if (raw && typeof raw === 'object') {
          const n = parseFloat(String(raw.amount ?? '0'));
          const decimals = Number(raw.decimals ?? 6);
          return Number.isFinite(n) ? n / 10 ** decimals : 0;
        }
        const n = parseFloat(String(raw ?? w.win_amount ?? '0'));
        if (!Number.isFinite(n) || n <= 0) return 0;
        return n > 1_000 ? n / 1_000_000 : n;
      };

      const winEntries = wins
        .map(w => ({ ticketId: String(w.user_ticket_id ?? w.ticket_id ?? ''), amount: parseAmount(w) }))
        .filter(w => w.ticketId && w.amount > 0);
      const totalAmount = winEntries.reduce((sum, w) => sum + w.amount, 0);

      const topTier = wins.reduce((best: number | null, w: any) => {
        const t = w.tier ?? w.win_tier ?? null;
        if (t == null) return best;
        const num = Number(t);
        return best === null ? num : Math.min(best, num);
      }, null as number | null);

      return totalAmount > 0
        ? { winAmountUsdc: parseFloat(totalAmount.toFixed(6)), tier: topTier, ticketIds: winEntries.map(w => w.ticketId) }
        : null;
    } catch (e: any) {
      this.logger.warn(`getWalletWinsForRound ${address} round ${roundId}: ${e.message}`);
      return null;
    }
  }

  async getWalletStats(address: string): Promise<MegapotWalletStats> {
    return this.apiGet<MegapotWalletStats>(`/wallets/${address}/stats`);
  }

  async getRound(roundId: string): Promise<MegapotRound> {
    const raw = await this.apiGet<any>(`/rounds/${roundId}`);
    return this.normalizeRound(raw);
  }

  /**
   * Real per-tier payouts from the most recently SETTLED round — not an estimate. Megapot's
   * `/rounds/{id}` only populates `prize_tiers` once a round settles (it's `null` while active),
   * because non-jackpot tiers are split pari-mutuel among however many tickets actually hit that
   * tier that day — a number nobody, including Megapot's own live UI, knows before the draw
   * closes. So "the most recent settled round's real numbers" is the closest thing to ground
   * truth that can be shown; a live/projected figure for the still-open round isn't obtainable.
   * Net figures apply DEFAULT_REFERRAL_WIN_SHARE_FACTOR (the same display-estimate cut used
   * elsewhere) — an individual ticket's actual claim factor is still read live at payout time via
   * getWinClaimFactor().
   */
  /** Builds a PrizeTiersSnapshot from a raw settled /rounds/{id} response, or null if unsettled. */
  private buildPrizeTiersSnapshot(round: any, roundId: string): PrizeTiersSnapshot | null {
    if (round.status !== 'settled' || !Array.isArray(round.prize_tiers)) return null;

    const byKey = new Map<string, any>(
      round.prize_tiers.map((t: any) => [`${t.normal_matches}:${!!t.bonusball_match}`, t]),
    );
    const tiers: PrizeTierInfo[] = PUBLIC_TIER_ORDER.map(({ normalMatches, bonusMatch }) => {
      const t = byKey.get(`${normalMatches}:${bonusMatch}`);
      const gross = t ? Number(t.payout?.amount ?? 0) / 10 ** (t.payout?.decimals ?? 6) : 0;
      return {
        normalMatches,
        bonusMatch,
        grossUsdc: gross,
        netUsdc: parseFloat((gross * DEFAULT_REFERRAL_WIN_SHARE_FACTOR).toFixed(6)),
        ticketCount: t?.ticket_count ?? 0,
      };
    });

    return {
      sourceRoundId: roundId,
      settledAt: round.settled_at ?? null,
      claimFactor: DEFAULT_REFERRAL_WIN_SHARE_FACTOR,
      tiers,
    };
  }

  async getLatestSettledPrizeTiers(): Promise<PrizeTiersSnapshot | null> {
    if (this.prizeTiersCache && Date.now() - this.prizeTiersCache.fetchedAt < MegapotService.PRIZE_TIERS_CACHE_TTL_MS) {
      return this.prizeTiersCache.data;
    }
    try {
      const active = await this.apiGet<any>('/rounds/active');
      const activeId = Number(active.id);
      if (!Number.isFinite(activeId)) return this.prizeTiersCache?.data ?? null;

      // Normally one hop back from the active round is settled; walk a few further back
      // defensively in case a round was skipped or is still finalizing.
      for (let candidate = activeId - 1; candidate > activeId - 5 && candidate > 0; candidate--) {
        const round = await this.apiGet<any>(`/rounds/${candidate}`);
        const data = this.buildPrizeTiersSnapshot(round, String(candidate));
        if (!data) continue;
        this.prizeTiersCache = { data, fetchedAt: Date.now() };
        return data;
      }
      this.logger.warn(`getLatestSettledPrizeTiers: no settled round with prize_tiers found within 4 rounds of active (${activeId})`);
      return this.prizeTiersCache?.data ?? null;
    } catch (e: any) {
      this.logger.warn(`getLatestSettledPrizeTiers: ${e.message} — serving stale cache if available`);
      return this.prizeTiersCache?.data ?? null;
    }
  }

  /**
   * Real per-tier payouts for one SPECIFIC round (as opposed to getLatestSettledPrizeTiers, which
   * walks back from whatever round is active right now). Used to price a ticket's own win by
   * matching its numbers against that exact round's drawn numbers — see resolveTicketWin's
   * ground-truth fallback for why this is needed independently of the "latest settled" cache.
   */
  async getPrizeTiersForRound(roundId: string): Promise<PrizeTiersSnapshot | null> {
    try {
      const round = await this.apiGet<any>(`/rounds/${roundId}`);
      return this.buildPrizeTiersSnapshot(round, roundId);
    } catch (e: any) {
      this.logger.warn(`getPrizeTiersForRound ${roundId}: ${e.message}`);
      return null;
    }
  }

  /** Fetch the winning numbers for a settled round. Returns null if not yet drawn or unknown format. */
  async getWinningNumbersForRound(roundId: string): Promise<{ main: number[]; bonus: number } | null> {
    try {
      const raw = await this.apiGet<any>(`/rounds/${roundId}`);
      // API returns winning_numbers: { normals: number[], bonusball: number }
      const wn = raw.winning_numbers;
      if (wn && Array.isArray(wn.normals) && wn.normals.length === 5 && wn.bonusball != null) {
        return { main: wn.normals, bonus: wn.bonusball };
      }
      return null;
    } catch (e: any) {
      this.logger.warn(`getWinningNumbersForRound ${roundId}: ${e.message}`);
      return null;
    }
  }

  /**
   * Read `referralWinShare` for a drawing from the Jackpot contract.
   * Returns the fraction the WINNER keeps (1 - referralWinShare).
   * e.g. if referralWinShare = 0.10e18 (10%), returns 0.9.
   * Retries transient RPC failures (rate limits are common on the public Base RPC) before giving
   * up. If it still can't read the real value, falls back to DEFAULT_REFERRAL_WIN_SHARE_FACTOR
   * (~10% cut, matching the documented protocol fee — see the "~10% protocol fee" comment in
   * lottery.service.ts) rather than 1.0/no-deduction. This is a display-estimate-only number:
   * whatever the user actually gets is always trued up from the real claimed on-chain balance at
   * redemption (see processConsolidatedBatch/processWithdrawal), so this only affects the
   * pre-claim figure shown before they've redeemed — a wrong fallback here was systematically
   * overstating that figure, not shortchanging anyone.
   */
  async getWinClaimFactor(drawingId: string): Promise<number> {
    const rpcUrl = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
    const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const state = await client.readContract({
          address: MEGAPOT_JACKPOT,
          abi: JACKPOT_ABI,
          functionName: 'getDrawingState',
          args: [BigInt(drawingId)],
        }) as any;
        const referralWinShare = BigInt(state.referralWinShare ?? 0n);
        const factor = 1 - Number(referralWinShare) / 1e18;
        this.logger.log(`getWinClaimFactor drawing=${drawingId}: referralWinShare=${Number(referralWinShare) / 1e18} → factor=${factor}`);
        return Math.max(0, Math.min(1, factor));
      } catch (e: any) {
        if (attempt < attempts - 1) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        this.logger.warn(`getWinClaimFactor drawing=${drawingId}: ${e.message} — falling back to conservative estimate (${DEFAULT_REFERRAL_WIN_SHARE_FACTOR}) after ${attempts} attempts`);
        return DEFAULT_REFERRAL_WIN_SHARE_FACTOR;
      }
    }
    return DEFAULT_REFERRAL_WIN_SHARE_FACTOR;
  }

  /**
   * Read the accrued, unclaimed referral fee balance for `referrerAddress` on the Jackpot
   * contract — a real, view-only balance (`referralFees(address)`), separate from any ticket
   * this app's backend controls. This wallet's private key is intentionally NOT held by this
   * backend (see admin UI) — claiming (`claimReferralFees()`, msg.sender-gated) is done manually
   * by whoever controls that wallet, e.g. via Basescan's "Write Contract" tab.
   */
  async getReferralFeesBalanceUsdc(referrerAddress: Address): Promise<number> {
    const client = this.getPublicClient();
    const balance = await client.readContract({
      address: MEGAPOT_JACKPOT,
      abi: JACKPOT_ABI,
      functionName: 'referralFees',
      args: [referrerAddress],
    }) as bigint;
    return Number(balance) / 1_000_000;
  }

  /**
   * Fetch actual ticket ball numbers for a companion wallet by scanning on-chain Transfer mint
   * events on the Megapot NFT contract, then reading each token's metadata via tokenURI.
   * The Megapot REST API does not index smart-account wallets (Rhinestone), so we go on-chain.
   */
  async getTicketNumbersFromNft(
    companionAddress: Address,
    roundId?: string | null,
  ): Promise<{ tokenIds: string[]; ticketNumbers: { main: number[]; bonus: number }[] }> {
    const client = this.getPublicClient();

    // Scan Transfer(from=0x0, to=companion) mint events in the last ~28 hours on Base, newest
    // block first — a companion smart account is created fresh per ticket and only ever receives
    // NFTs from the one purchase it made, so the mint events are always near `latest` and scanning
    // backwards lets us stop as soon as we've paged past them instead of always walking the whole
    // window.
    const latest = await client.getBlockNumber();
    const floorBlock = latest > 150_000n ? latest - 150_000n : 0n;

    const transferEvent = {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'tokenId', type: 'uint256', indexed: true },
      ],
    } as const;

    // Helper keeps the event-typed overload so log.args is properly typed downstream
    const fetchRange = (from: bigint, to: bigint) => client.getLogs({
      address: MEGAPOT_TICKET_NFT,
      event: transferEvent,
      args: {
        from: '0x0000000000000000000000000000000000000000' as Address,
        to: companionAddress,
      },
      fromBlock: from,
      toBlock: to,
    });

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Adaptive chunk size: this used to assume the RPC allows 9,900-block eth_getLogs calls, but
    // some tiers (e.g. Alchemy's free plan) cap it as low as 10 blocks — every single call failed
    // outright in that case (surfaced as "playAgain: NFT number fetch for new ticket: ..." warnings
    // that left ticket_nft_ids permanently unpopulated). On a range-limit error, parse the
    // provider's suggested max (or just halve) and retry that same sub-range, so this self-adapts
    // to whatever the configured RPC actually allows instead of needing per-provider tuning.
    let chunk = 9_900n;
    let logs: Awaited<ReturnType<typeof fetchRange>> = [];
    let to = latest;
    let blocksSinceLastHit = 0n;
    let iterations = 0;
    const MAX_ITERATIONS = 300; // bounds worst-case latency for a cold/never-synced old ticket

    while (to >= floorBlock && iterations < MAX_ITERATIONS) {
      iterations++;
      const from = to - chunk + 1n > floorBlock ? to - chunk + 1n : floorBlock;
      try {
        const found = await fetchRange(from, to);
        if (found.length) {
          logs = logs.concat(found);
          blocksSinceLastHit = 0n;
        } else {
          blocksSinceLastHit += to - from + 1n;
        }
        to = from - 1n;
        await sleep(120);
      } catch (e: any) {
        const errText = [e?.details, e?.shortMessage, e?.message, e?.cause?.details, e?.cause?.shortMessage, e?.cause?.message]
          .filter(Boolean).join(' ');
        const suggested = /up to an? (\d+) block range/i.exec(errText)?.[1];
        const next = suggested ? BigInt(suggested) : chunk > 1n ? chunk / 2n : null;
        if (!next) throw e;
        chunk = next;
        await sleep(150);
        continue;
      }
      // All mint events for a companion share one purchase block — once we've found some and
      // scanned safely past them with no more turning up, the rest of the window won't have any.
      if (logs.length && blocksSinceLastHit >= 500n) break;
    }
    if (iterations >= MAX_ITERATIONS && !logs.length) {
      this.logger.warn(`getTicketNumbersFromNft: companion=${companionAddress} gave up after ${iterations} chunked eth_getLogs calls without finding a mint event — check BASE_RPC_URL's eth_getLogs block-range limit`);
    }

    this.logger.log(`getTicketNumbersFromNft: companion=${companionAddress} roundId=${roundId} → ${logs.length} mint events`);

    if (logs.length === 0) return { tokenIds: [], ticketNumbers: [] };

    const tokenIds: string[] = [];
    const ticketNumbers: { main: number[]; bonus: number }[] = [];

    for (const log of logs) {
      const tokenId = log.args.tokenId?.toString();
      if (!tokenId) continue;

      let rawUri: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) await sleep(600 * attempt);
          rawUri = await client.readContract({
            address: MEGAPOT_TICKET_NFT,
            abi: TICKET_NFT_ABI,
            functionName: 'tokenURI',
            args: [BigInt(tokenId)],
          }) as string;
          break;
        } catch (e: any) {
          if (attempt === 2) this.logger.warn(`getTicketNumbersFromNft: failed for token ${tokenId}: ${e.message}`);
        }
      }
      if (!rawUri) {
        await sleep(200);
        continue;
      }

      try {
        let metadata: { attributes?: Array<{ trait_type: string; value: unknown }> };
        if (rawUri.startsWith('data:application/json;base64,')) {
          metadata = JSON.parse(Buffer.from(rawUri.slice(29), 'base64').toString('utf-8'));
        } else if (rawUri.startsWith('data:application/json,')) {
          metadata = JSON.parse(decodeURIComponent(rawUri.slice(22)));
        } else {
          const res = await fetch(rawUri, { signal: AbortSignal.timeout(5_000) });
          metadata = await res.json() as typeof metadata;
        }

        const attrs = metadata?.attributes ?? [];
        const get = (name: string) => attrs.find(a => a.trait_type === name)?.value;

        const drawingId = String(get('Drawing ID') ?? '');
        if (roundId && drawingId && drawingId !== String(roundId)) {
          this.logger.log(`Token ${tokenId} is round ${drawingId}, skipping (want ${roundId})`);
          await sleep(150);
          continue;
        }

        const main = [1, 2, 3, 4, 5]
          .map(i => Number(get(`Normal Ball ${i}`)))
          .filter(n => Number.isFinite(n) && n > 0);
        const bonus = Number(get('Bonus Ball'));

        if (main.length === 5 && Number.isFinite(bonus) && bonus > 0) {
          tokenIds.push(tokenId);
          ticketNumbers.push({ main, bonus });
        }
      } catch (e: any) {
        this.logger.warn(`getTicketNumbersFromNft: metadata parse failed for token ${tokenId}: ${e.message}`);
      }
      await sleep(150);
    }

    return { tokenIds, ticketNumbers };
  }

  /**
   * Fetch ticket ball numbers from the Megapot REST API.
   * Faster than on-chain scanning — no RPC calls needed.
   * Returns empty array if the wallet is not indexed (e.g. Rhinestone smart accounts)
   * or if the round hasn't settled yet.
   */
  async getTicketNumbersFromApi(
    companionAddress: Address,
    roundId?: string | null,
  ): Promise<{ ticketNumbers: { main: number[]; bonus: number }[] }> {
    const path = roundId
      ? `/wallets/${companionAddress}/tickets/rounds/${roundId}`
      : `/wallets/${companionAddress}/tickets`;

    try {
      const data = await this.apiGet<{ data: MegapotTicket[] }>(path);
      const tickets = data.data ?? [];
      const ticketNumbers: { main: number[]; bonus: number }[] = [];

      for (const t of tickets) {
        if (Array.isArray(t.normals) && t.normals.length === 5 && t.bonusball != null) {
          ticketNumbers.push({ main: t.normals, bonus: t.bonusball });
        }
      }

      this.logger.log(
        `getTicketNumbersFromApi: companion=${companionAddress} roundId=${roundId} → ${ticketNumbers.length} tickets`,
      );
      return { ticketNumbers };
    } catch (e: any) {
      this.logger.warn(`getTicketNumbersFromApi failed for ${companionAddress}: ${e.message}`);
      return { ticketNumbers: [] };
    }
  }

  /**
   * Read Tier + Win Amount from on-chain NFT metadata for a set of token IDs.
   * After Megapot runs the draw, these attributes are populated in the tokenURI.
   * Returns winAmountUsdc = 0 for losing tickets or tickets not yet drawn.
   * Also returns the metadata's own "Drawing ID" — the real on-chain _drawingId that
   * getDrawingState()/getWinClaimFactor() need. This is NOT the same as Megapot's off-chain
   * Data-API round.id (see the 90%-payout incident this was added to fix) — passing the wrong
   * one makes getDrawingState() silently return a zeroed struct instead of reverting.
   */
  async checkTicketResultsFromNft(
    tokenIds: string[],
  ): Promise<{ tokenId: string; tier: number | null; winAmountUsdc: number; drawingId: string | null }[]> {
    if (!tokenIds.length) return [];
    const client = this.getPublicClient();
    const results: { tokenId: string; tier: number | null; winAmountUsdc: number; drawingId: string | null }[] = [];
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (const tokenId of tokenIds) {
      await sleep(400); // throttle between calls — public Base RPC rate-limits burst requests
      let rawUri: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) await sleep(1_000 * attempt);
          rawUri = await client.readContract({
            address: MEGAPOT_TICKET_NFT,
            abi: TICKET_NFT_ABI,
            functionName: 'tokenURI',
            args: [BigInt(tokenId)],
          }) as string;
          break;
        } catch (e: any) {
          if (attempt === 2) this.logger.warn(`checkTicketResultsFromNft failed for token ${tokenId}: ${e.message}`);
        }
      }
      try {
        if (!rawUri) continue;

        let metadata: { attributes?: Array<{ trait_type: string; value: unknown }> };
        if (rawUri.startsWith('data:application/json;base64,')) {
          metadata = JSON.parse(Buffer.from(rawUri.slice(29), 'base64').toString('utf-8'));
        } else if (rawUri.startsWith('data:application/json,')) {
          metadata = JSON.parse(decodeURIComponent(rawUri.slice(22)));
        } else {
          const res = await fetch(rawUri, { signal: AbortSignal.timeout(5_000) });
          metadata = await res.json() as typeof metadata;
        }

        const attrs = metadata?.attributes ?? [];
        const get = (name: string) => attrs.find(a => a.trait_type === name)?.value;

        const tier = get('Tier') != null ? Number(get('Tier')) : null;
        const rawWin = get('Win Amount');
        const drawingId = String(get('Drawing ID') ?? '') || null;

        let winAmountUsdc = 0;
        if (rawWin != null && rawWin !== '' && String(rawWin) !== '0') {
          const n = parseFloat(String(rawWin));
          if (Number.isFinite(n) && n > 0) {
            // Megapot stores amounts as raw USDC (6 decimals) on-chain but may
            // display as USD string in metadata — detect by magnitude
            winAmountUsdc = n > 1_000 ? n / 1_000_000 : n;
          }
        }

        this.logger.log(`NFT ${tokenId}: tier=${tier} rawWin=${rawWin} drawingId=${drawingId} → $${winAmountUsdc}`);
        results.push({ tokenId, tier, winAmountUsdc, drawingId });
      } catch (e: any) {
        this.logger.warn(`checkTicketResultsFromNft failed for token ${tokenId}: ${e.message}`);
      }
    }

    return results;
  }

  /**
   * Ground-truth claimability check for a single NFT: simulates claimWinnings directly against
   * the contract instead of trusting the NFT's own tokenURI metadata. Real incident: a ticket
   * whose Data-API-confirmed win was $1, with a single stored NFT whose metadata read
   * `tier=2, Win Amount=0` on every retry over 30+ seconds — never changing. Simulating
   * claimWinnings for that exact token against the real chain succeeded immediately (the contract
   * itself considered it a winner), proving the metadata trait was simply wrong, not stale. A
   * dry-run that doesn't revert is authoritative; one that does means it truly isn't claimable
   * right now (e.g. the round hasn't settled) — either way this is a stronger signal than the
   * metadata read alone.
   */
  async isTokenClaimable(companionAddress: Address, tokenId: bigint): Promise<boolean> {
    const client = this.getPublicClient();
    try {
      await client.simulateContract({
        address: MEGAPOT_JACKPOT,
        abi: JACKPOT_ABI,
        functionName: 'claimWinnings',
        args: [[tokenId]],
        account: companionAddress,
      });
      return true;
    } catch (e: any) {
      this.logger.log(`isTokenClaimable: token ${tokenId} not claimable — ${e?.shortMessage ?? e?.message}`);
      return false;
    }
  }

  // ─── Contract reads ────────────────────────────────────────────────────────

  private getPublicClient() {
    const rpc = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
    return createPublicClient({ chain: base, transport: http(rpc) });
  }

  async getUsdcBalance(address: Address): Promise<bigint> {
    const client = this.getPublicClient();
    return client.readContract({
      address: MEGAPOT_USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    });
  }

  // ─── Contract writes ───────────────────────────────────────────────────────

  private getWalletClient(privateKey: string) {
    const rpc = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    return {
      client: createWalletClient({ chain: base, transport: http(rpc), account }),
      account,
    };
  }

  /** Get ETH balance of an address on Base (formatted as ETH string). */
  async getEthBalance(address: Address): Promise<string> {
    const publicClient = this.getPublicClient();
    const wei = await publicClient.getBalance({ address });
    return (Number(wei) / 1e18).toFixed(8);
  }

  /** Fund companion wallet with ETH for gas (from BASE_FUNDER_PRIVATE_KEY). */
  async ensureGas(companionAddress: Address): Promise<void> {
    const funderKey = this.config.get<string>('BASE_FUNDER_PRIVATE_KEY');
    if (!funderKey) {
      this.logger.warn('BASE_FUNDER_PRIVATE_KEY not set — skipping gas funding');
      return;
    }
    try {
      const publicClient = this.getPublicClient();
      const balance = await publicClient.getBalance({ address: companionAddress });
      if (balance >= 300_000_000_000n) return; // > 0.0000003 ETH, enough
      const rpc = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
      const { createWalletClient: wc, http: h, parseEther } = await import('viem');
      const account = privateKeyToAccount(funderKey as `0x${string}`);
      const wallet = wc({ chain: base, transport: h(rpc), account });
      await wallet.sendTransaction({ to: companionAddress, value: parseEther('0.005') });
      this.logger.log(`Funded ${companionAddress} with 0.005 ETH for gas`);
    } catch (err: any) {
      this.logger.warn(`ensureGas failed for ${companionAddress}: ${err.message}`);
    }
  }

  /** Approve USDC spend and buy tickets from companion wallet. Returns tx hash. */
  async buyTickets(opts: {
    companionPrivateKey: string;
    numTickets: number;
    recipient: Address;
  }): Promise<string> {
    const { companionPrivateKey, numTickets, recipient } = opts;
    const { client, account } = this.getWalletClient(companionPrivateKey);
    const publicClient = this.getPublicClient();

    const cost = parseUnits(String(numTickets * MEGAPOT_TICKET_PRICE_USDC), 6);

    // Approve USDC → random ticket buyer
    const approveTx = await client.writeContract({
      address: MEGAPOT_USDC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MEGAPOT_RANDOM_BUYER, cost],
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    this.logger.log(`USDC approved for ${numTickets} tickets from ${account.address}`);

    const referrers: Address[] = this.referrerWallet ? [this.referrerWallet] : [];
    const splits: bigint[] = this.referrerWallet ? [1_000_000_000_000_000_000n] : [];

    const buyTx = await client.writeContract({
      address: MEGAPOT_RANDOM_BUYER,
      abi: RANDOM_BUYER_ABI,
      functionName: 'buyTickets',
      args: [BigInt(numTickets), recipient, referrers, splits, this.sourceId],
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: buyTx });
    this.logger.log(`Bought ${numTickets} ticket(s), tx: ${buyTx}`);
    return buyTx;
  }

  /** Claim winnings from companion wallet. Returns tx hash. */
  async claimWinnings(opts: {
    companionPrivateKey: string;
    ticketNftIds: bigint[];
  }): Promise<string> {
    const { companionPrivateKey, ticketNftIds } = opts;
    const { client, account } = this.getWalletClient(companionPrivateKey);
    const publicClient = this.getPublicClient();

    const tx = await client.writeContract({
      address: MEGAPOT_JACKPOT,
      abi: JACKPOT_ABI,
      functionName: 'claimWinnings',
      args: [ticketNftIds],
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    this.logger.log(`Claimed winnings for ${ticketNftIds.length} ticket(s), tx: ${tx}`);
    return tx;
  }

  /** Transfer USDC from companion to a Base address (free withdrawal). */
  async transferUsdcOnBase(opts: {
    companionPrivateKey: string;
    to: Address;
    amountUsdc: number;
  }): Promise<string> {
    const { companionPrivateKey, to, amountUsdc } = opts;
    const { client, account } = this.getWalletClient(companionPrivateKey);
    const publicClient = this.getPublicClient();

    const amount = parseUnits(String(amountUsdc), 6);
    const tx = await client.writeContract({
      address: MEGAPOT_USDC,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, amount],
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    this.logger.log(`Transferred ${amountUsdc} USDC from ${account.address} to ${to}, tx: ${tx}`);
    return tx;
  }
}
