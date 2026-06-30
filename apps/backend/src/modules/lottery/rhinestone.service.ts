import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, encodeFunctionData, erc20Abi, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { RhinestoneSDK } from '@rhinestone/sdk';
import type { RhinestoneAccount } from '@rhinestone/sdk';

const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MEGAPOT_RANDOM_BUYER: Address = '0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd';
const MEGAPOT_JACKPOT: Address = '0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2';

const JACKPOT_CLAIM_ABI = [
  {
    name: 'claimWinnings',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_userTicketIds', type: 'uint256[]' }],
    outputs: [],
  },
] as const;

const RANDOM_BUYER_ABI = [
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

const safeJson = (v: any) => JSON.stringify(v, (_, val) => typeof val === 'bigint' ? val.toString() : val);

@Injectable()
export class RhinestoneService {
  private readonly logger = new Logger(RhinestoneService.name);
  private sdk: RhinestoneSDK;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RHINESTONE_API_KEY', '');
    this.sdk = new RhinestoneSDK({ apiKey });
    this.logger.log(`Rhinestone SDK: ${apiKey ? apiKey.slice(0, 8) + '...' : 'NOT SET'}`);
  }

  private get baseRpcUrl() {
    return this.config.get<string>('BASE_RPC_URL', 'https://mainnet.base.org');
  }

  private async getAccount(ownerKey: `0x${string}`): Promise<RhinestoneAccount> {
    const owner = privateKeyToAccount(ownerKey);
    return this.sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
    });
  }

  /**
   * Compute the companion's Rhinestone smart account address from its owner key.
   * Deterministic — no API calls. Call once in initiatePurchase and store as companion_address.
   */
  async getCompanionAddress(ownerKey: `0x${string}`): Promise<Address> {
    const account = await this.getAccount(ownerKey);
    return account.getAddress();
  }

  /**
   * Buy Megapot tickets from the companion smart account.
   * Gas is sponsored by Rhinestone — companion needs no ETH, only USDC.
   */
  async buyMegapotTickets(opts: {
    companionPrivateKey: `0x${string}`;
    numTickets: number;
    recipient: Address;
    sourceId: `0x${string}`;
    referrers?: Address[];
    splits?: bigint[];
  }): Promise<void> {
    const { companionPrivateKey, numTickets, recipient, sourceId, referrers = [], splits = [] } = opts;
    const cost = BigInt(numTickets * 1_000_000);

    const account = await this.getAccount(companionPrivateKey);
    this.logger.log(`Rhinestone: buying ${numTickets} ticket(s) from ${account.getAddress()}`);

    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [MEGAPOT_RANDOM_BUYER, cost],
    });

    const buyData = encodeFunctionData({
      abi: RANDOM_BUYER_ABI,
      functionName: 'buyTickets',
      args: [BigInt(numTickets), recipient, referrers, splits, sourceId],
    });

    const result = await account.sendTransaction({
      chain: base,
      calls: [
        { to: USDC_BASE, data: approveData },
        { to: MEGAPOT_RANDOM_BUYER, data: buyData },
      ],
      sponsored: true,
    });

    const status = await account.waitForExecution(result);
    this.logger.log(`Rhinestone buy complete: ${safeJson(status)}`);
  }

  /**
   * Claim Megapot winnings from the companion smart account.
   * Gas is sponsored by Rhinestone — companion needs no ETH.
   * Returns the userOp/transaction hash from the execution.
   */
  async claimWinnings(opts: {
    companionPrivateKey: `0x${string}`;
    ticketNftIds: bigint[];
  }): Promise<string> {
    const { companionPrivateKey, ticketNftIds } = opts;
    const account = await this.getAccount(companionPrivateKey);
    const smartAcctAddress = account.getAddress() as Address;
    this.logger.log(`Rhinestone: claiming ${ticketNftIds.length} winning ticket(s) from ${smartAcctAddress}`);

    // Dry-run with publicClient to surface the exact revert reason before sending via Rhinestone.
    const publicClient = createPublicClient({ chain: base, transport: http(this.baseRpcUrl) });
    try {
      await publicClient.simulateContract({
        address: MEGAPOT_JACKPOT,
        abi: JACKPOT_CLAIM_ABI,
        functionName: 'claimWinnings',
        args: [ticketNftIds],
        account: smartAcctAddress,
      });
      this.logger.log(`Rhinestone: dry-run OK — proceeding with sponsored sendTransaction`);
    } catch (simErr: any) {
      // Log the raw revert reason so we can diagnose and rethrow for the fallback path
      this.logger.warn(`Rhinestone: dry-run revert from ${smartAcctAddress}: ${simErr.message?.slice(0, 200)}`);
      throw simErr;
    }

    const claimData = encodeFunctionData({
      abi: JACKPOT_CLAIM_ABI,
      functionName: 'claimWinnings',
      args: [ticketNftIds],
    });

    const result = await account.sendTransaction({
      chain: base,
      calls: [{ to: MEGAPOT_JACKPOT, data: claimData }],
      sponsored: true,
    });

    const status = await account.waitForExecution(result) as any;
    const txHash = status?.fill?.hash ?? (typeof result === 'string' ? result : safeJson(result));
    this.logger.log(`Rhinestone claim complete: txHash=${txHash}`);
    return txHash;
  }

  /**
   * Execute a Li.Fi EVM swap from the companion smart account.
   * Batches the USDC approval + Li.Fi swap call into one sponsored userOp.
   * Gas is sponsored by Rhinestone — companion needs no ETH.
   */
  async executeLifiSwap(opts: {
    companionPrivateKey: `0x${string}`;
    approvalAddress?: Address;
    fromAmountRaw: bigint;
    swapTo: Address;
    swapData: `0x${string}`;
    swapValue?: bigint;
    toChainAddress?: string; // for logging only — actual Solana recipient
  }): Promise<string> {
    const { companionPrivateKey, approvalAddress, fromAmountRaw, swapTo, swapData, swapValue = 0n, toChainAddress } = opts;
    const account = await this.getAccount(companionPrivateKey);
    this.logger.log(`Rhinestone: Li.Fi swap from ${account.getAddress()} → ${toChainAddress ?? swapTo} (via router ${swapTo})`);

    const calls: { to: Address; data: `0x${string}`; value?: bigint }[] = [];

    if (approvalAddress) {
      const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [approvalAddress, fromAmountRaw],
      });
      calls.push({ to: USDC_BASE, data: approveData });
    }

    calls.push({ to: swapTo, data: swapData, value: swapValue > 0n ? swapValue : undefined });

    const result = await account.sendTransaction({
      chain: base,
      calls,
      sponsored: true,
    });

    const execStatus = await account.waitForExecution(result) as any;
    const hash = execStatus?.fill?.hash ?? (typeof result === 'string' ? result : safeJson(result));
    this.logger.log(`Rhinestone Li.Fi swap complete: txHash=${hash}`);
    return hash;
  }

  /**
   * Rescue USDC from a companion smart account back to Loofta's wallet.
   * Gas is sponsored by Rhinestone.
   */
  async rescueUsdc(opts: {
    companionPrivateKey: `0x${string}`;
    rescueWallet: Address;
    amountUsdc: number;
  }): Promise<void> {
    const { companionPrivateKey, rescueWallet, amountUsdc } = opts;
    const amountRaw = BigInt(Math.round(amountUsdc * 1_000_000));

    const account = await this.getAccount(companionPrivateKey);
    this.logger.log(`Rhinestone rescue: ${amountUsdc} USDC from ${account.getAddress()} → ${rescueWallet}`);

    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [rescueWallet, amountRaw],
    });

    const result = await account.sendTransaction({
      chain: base,
      calls: [{ to: USDC_BASE, data: transferData }],
      sponsored: true,
    });

    await account.waitForExecution(result);
    this.logger.log(`Rhinestone rescue complete`);
  }
}
