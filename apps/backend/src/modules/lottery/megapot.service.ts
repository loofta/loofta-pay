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

@Injectable()
export class MegapotService {
  private readonly logger = new Logger(MegapotService.name);
  private readonly apiKey: string;
  private readonly referrerWallet: Address | null;
  private readonly sourceId: `0x${string}`;

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
    return {
      ...raw,
      drawTime: raw.ended_at ?? raw.draw_time ?? raw.drawTime ?? null,
      prizePool: raw.prize_pool?.amount ?? raw.prizePool ?? null,
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

  /** Check if a companion wallet won in a specific round via the Data API. Returns null if no win or wallet not indexed. */
  async getWalletWinsForRound(
    address: Address,
    roundId: string,
  ): Promise<{ winAmountUsdc: number; tier: number | null } | null> {
    try {
      const res = await this.apiGet<{ data: any[] }>(`/wallets/${address}/wins/rounds/${roundId}`);
      const wins = res.data ?? [];
      if (!wins.length) return null;
      const totalAmount = wins.reduce((sum: number, w: any) => {
        const raw = w.amount ?? w.win_amount ?? '0';
        const n = parseFloat(String(raw));
        if (!Number.isFinite(n) || n <= 0) return sum;
        return sum + (n > 1_000 ? n / 1_000_000 : n);
      }, 0);
      const topTier = wins.reduce((best: number | null, w: any) => {
        const t = w.tier ?? w.win_tier ?? null;
        if (t == null) return best;
        const num = Number(t);
        return best === null ? num : Math.min(best, num);
      }, null as number | null);
      return totalAmount > 0 ? { winAmountUsdc: totalAmount, tier: topTier } : null;
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
   * Falls back to 1.0 (no deduction) on any error, so we err toward showing the gross amount.
   */
  async getWinClaimFactor(drawingId: string): Promise<number> {
    try {
      const rpcUrl = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
      const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
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
      this.logger.warn(`getWinClaimFactor drawing=${drawingId}: ${e.message} — falling back to gross`);
      return 1;
    }
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

    // Scan Transfer(from=0x0, to=companion) mint events in the last ~28 hours on Base.
    // Base mainnet public RPC caps eth_getLogs at 10,000 blocks per call — paginate in 9,900-block chunks.
    const latest = await client.getBlockNumber();
    const fromBlock = latest > 150_000n ? latest - 150_000n : 0n;
    const CHUNK = 9_900n;

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
    const fetchChunk = (from: bigint, to: bigint) => client.getLogs({
      address: MEGAPOT_TICKET_NFT,
      event: transferEvent,
      args: {
        from: '0x0000000000000000000000000000000000000000' as Address,
        to: companionAddress,
      },
      fromBlock: from,
      toBlock: to,
    });

    const logChunks: Awaited<ReturnType<typeof fetchChunk>>[] = [];
    for (let from = fromBlock; from <= latest; from += CHUNK) {
      const to = from + CHUNK - 1n < latest ? from + CHUNK - 1n : latest;
      logChunks.push(await fetchChunk(from, to));
    }
    const logs = logChunks.flat();

    this.logger.log(`getTicketNumbersFromNft: companion=${companionAddress} roundId=${roundId} → ${logs.length} mint events`);

    if (logs.length === 0) return { tokenIds: [], ticketNumbers: [] };

    const tokenIds: string[] = [];
    const ticketNumbers: { main: number[]; bonus: number }[] = [];

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
   */
  async checkTicketResultsFromNft(
    tokenIds: string[],
  ): Promise<{ tokenId: string; tier: number | null; winAmountUsdc: number }[]> {
    if (!tokenIds.length) return [];
    const client = this.getPublicClient();
    const results: { tokenId: string; tier: number | null; winAmountUsdc: number }[] = [];

    for (const tokenId of tokenIds) {
      try {
        const rawUri = await client.readContract({
          address: MEGAPOT_TICKET_NFT,
          abi: TICKET_NFT_ABI,
          functionName: 'tokenURI',
          args: [BigInt(tokenId)],
        }) as string;

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

        let winAmountUsdc = 0;
        if (rawWin != null && rawWin !== '' && String(rawWin) !== '0') {
          const n = parseFloat(String(rawWin));
          if (Number.isFinite(n) && n > 0) {
            // Megapot stores amounts as raw USDC (6 decimals) on-chain but may
            // display as USD string in metadata — detect by magnitude
            winAmountUsdc = n > 1_000 ? n / 1_000_000 : n;
          }
        }

        this.logger.log(`NFT ${tokenId}: tier=${tier} rawWin=${rawWin} → $${winAmountUsdc}`);
        results.push({ tokenId, tier, winAmountUsdc });
      } catch (e: any) {
        this.logger.warn(`checkTicketResultsFromNft failed for token ${tokenId}: ${e.message}`);
      }
    }

    return results;
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
