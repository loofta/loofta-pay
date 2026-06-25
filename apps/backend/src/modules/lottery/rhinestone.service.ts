import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encodeFunctionData, erc20Abi, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { RhinestoneSDK } from '@rhinestone/sdk';
import type { RhinestoneAccount } from '@rhinestone/sdk';

const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MEGAPOT_RANDOM_BUYER: Address = '0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd';

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

@Injectable()
export class RhinestoneService {
  private readonly logger = new Logger(RhinestoneService.name);
  private sdk: RhinestoneSDK;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RHINESTONE_API_KEY', '');
    this.sdk = new RhinestoneSDK({ apiKey });
    this.logger.log(`Rhinestone SDK: ${apiKey ? apiKey.slice(0, 8) + '...' : 'NOT SET'}`);
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
    this.logger.log(`Rhinestone buy complete: ${JSON.stringify(status)}`);
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
