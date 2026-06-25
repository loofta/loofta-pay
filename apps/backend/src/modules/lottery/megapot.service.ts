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
export const MEGAPOT_TICKET_PRICE_USDC = 1; // $1 per ticket

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
] as const;

export interface MegapotRound {
  id: string;
  drawTime: string;
  prizePool: string;
  ticketsSold: number;
  status: string;
}

export interface MegapotTicket {
  id: string;
  roundId: string;
  walletAddress: string;
  ticketCount: number;
  createdAt: string;
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

  async getActiveRound(): Promise<MegapotRound> {
    return this.apiGet<MegapotRound>('/rounds/active');
  }

  async getWalletTickets(address: string): Promise<MegapotTicket[]> {
    const data = await this.apiGet<{ tickets: MegapotTicket[] }>(`/wallets/${address}/tickets`);
    return data.tickets ?? [];
  }

  async getWalletWins(address: string): Promise<MegapotWin[]> {
    const data = await this.apiGet<{ wins: MegapotWin[] }>(`/wallets/${address}/wins`);
    return data.wins ?? [];
  }

  async getWalletStats(address: string): Promise<MegapotWalletStats> {
    return this.apiGet<MegapotWalletStats>(`/wallets/${address}/stats`);
  }

  async getRound(roundId: string): Promise<MegapotRound> {
    return this.apiGet<MegapotRound>(`/rounds/${roundId}`);
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
