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

// JackpotRandomTicketBuyer picks each ticket's numbers on-chain via TicketPicker.pickAuto, which
// rebuilds and Fisher-Yates shuffles the ENTIRE ball range per ticket (FisherYatesWithRejection.sol)
// — gas scales as ticket count × ball range, not just ticket count. A single large quick-pick buy
// (e.g. 50 tickets) can exceed the tx/sponsorship gas ceiling even though nothing in this contract
// or Rhinestone enforces a count limit — it just silently reverts every retry. Real incident: a
// user's two 50-ticket buys both failed this way and had to be rescued (Sept 2026). Chunk into
// separate transactions so a big order degrades to "slower" instead of "fails outright."
const MAX_TICKETS_PER_BUY_TX = 10;

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

// Real Jackpot.buyTickets signature (distinct from RANDOM_BUYER_ABI above, which targets the
// separate JackpotRandomTicketBuyer contract) — takes an explicit array of {normals, bonusball}
// per ticket, the only on-chain path that supports user-chosen numbers. See megapot.service.ts's
// JACKPOT_BUY_TUPLE_ABI for the verification notes.
const JACKPOT_BUY_TUPLE_ABI = [
  {
    name: 'buyTickets',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: '_tickets',
        type: 'tuple[]',
        components: [
          { name: 'normals', type: 'uint8[]' },
          { name: 'bonusball', type: 'uint8' },
        ],
      },
      { name: '_recipient', type: 'address' },
      { name: '_referrers', type: 'address[]' },
      { name: '_referralSplit', type: 'uint256[]' },
      { name: '_source', type: 'bytes32' },
    ],
    outputs: [{ name: 'ticketIds', type: 'uint256[]' }],
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
    const account = await this.getAccount(companionPrivateKey);

    // See MAX_TICKETS_PER_BUY_TX above — split into multiple sponsored transactions of at most
    // that many tickets each, so gas for the on-chain random ball generation can't compound past
    // the point where the whole buy fails. Sequential (not parallel): each chunk spends real USDC
    // out of the companion's balance, and later chunks would race the earlier ones' approvals.
    let remaining = numTickets;
    while (remaining > 0) {
      const chunk = Math.min(remaining, MAX_TICKETS_PER_BUY_TX);
      const cost = BigInt(chunk * 1_000_000);

      const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [MEGAPOT_RANDOM_BUYER, cost],
      });

      const buyData = encodeFunctionData({
        abi: RANDOM_BUYER_ABI,
        functionName: 'buyTickets',
        args: [BigInt(chunk), recipient, referrers, splits, sourceId],
      });

      this.logger.log(`Rhinestone: buying ${chunk} ticket(s) (${numTickets - remaining + chunk}/${numTickets} total) from ${account.getAddress()}`);

      const result = await account.sendTransaction({
        chain: base,
        calls: [
          { to: USDC_BASE, data: approveData },
          { to: MEGAPOT_RANDOM_BUYER, data: buyData },
        ],
        sponsored: true,
      });

      const status = await account.waitForExecution(result);
      this.logger.log(`Rhinestone buy complete (${chunk} ticket(s)): ${safeJson(status)}`);

      remaining -= chunk;
    }
  }

  /**
   * Buy Megapot tickets with specific user-chosen numbers, straight from the Jackpot contract
   * (not the RandomTicketBuyer wrapper `buyMegapotTickets` above uses — that contract is
   * count-only and cannot carry numbers). Same sponsored-batch pattern: approve + buy in one
   * userOp. Dry-run simulated first (mirrors claimWinnings below) so a bad ticket/bounds mismatch
   * surfaces a clear revert reason in logs instead of a silently-failed sponsored tx.
   *
   * The dry-run simulates ONLY `buyTickets` against current on-chain state — it has no way to
   * see the `approve` that gets batched immediately before it in the real sendTransaction below,
   * so it will always revert with an allowance error even when the real batch would succeed
   * (approve lands first, in the same userOp, then buyTickets reads that fresh allowance). That
   * specific revert is therefore expected noise, not a real problem — this used to cause every
   * custom-number purchase to fail as "ERC20: transfer amount exceeds allowance" and abort
   * before the real (working) batched tx ever ran, unrecoverable by retrying since nothing ever
   * reached the chain to change the allowance. Any OTHER revert reason (bad ticket bounds,
   * duplicate numbers, sold out, etc.) still aborts here as intended.
   */
  async buyMegapotTicketsCustom(opts: {
    companionPrivateKey: `0x${string}`;
    tickets: { normals: number[]; bonusball: number }[];
    recipient: Address;
    sourceId: `0x${string}`;
    referrers?: Address[];
    splits?: bigint[];
  }): Promise<void> {
    const { companionPrivateKey, tickets, recipient, sourceId, referrers = [], splits = [] } = opts;
    const cost = BigInt(tickets.length * 1_000_000);

    const account = await this.getAccount(companionPrivateKey);
    const smartAcctAddress = account.getAddress() as Address;
    this.logger.log(`Rhinestone: buying ${tickets.length} custom ticket(s) from ${smartAcctAddress}`);

    const publicClient = createPublicClient({ chain: base, transport: http(this.baseRpcUrl) });
    try {
      await publicClient.simulateContract({
        address: MEGAPOT_JACKPOT,
        abi: JACKPOT_BUY_TUPLE_ABI,
        functionName: 'buyTickets',
        args: [tickets, recipient, referrers, splits, sourceId],
        account: smartAcctAddress,
      });
      this.logger.log(`Rhinestone: custom buy dry-run OK — proceeding with sponsored sendTransaction`);
    } catch (simErr: any) {
      const msg: string = simErr.message ?? '';
      const isRpcError = msg.includes('over rate limit') || msg.includes('RPC Request failed') ||
                         msg.includes('timeout') || msg.includes('429');
      // Expected: the dry-run can't see the approve that's batched immediately before this call
      // in the real sendTransaction below, so it always looks under-allowanced in isolation.
      const isExpectedAllowanceGap = msg.includes('exceeds allowance') || msg.includes('insufficient allowance');
      if (isRpcError) {
        this.logger.warn(`Rhinestone: custom buy dry-run skipped (RPC error, not a revert): ${msg.slice(0, 120)}`);
      } else if (isExpectedAllowanceGap) {
        this.logger.log(`Rhinestone: custom buy dry-run allowance gap (expected — approve is batched before buy) — proceeding with sponsored sendTransaction`);
      } else {
        this.logger.warn(`Rhinestone: custom buy dry-run revert from ${smartAcctAddress}: ${msg.slice(0, 200)}`);
        throw simErr;
      }
    }

    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [MEGAPOT_JACKPOT, cost],
    });

    const buyData = encodeFunctionData({
      abi: JACKPOT_BUY_TUPLE_ABI,
      functionName: 'buyTickets',
      args: [tickets, recipient, referrers, splits, sourceId],
    });

    const result = await account.sendTransaction({
      chain: base,
      calls: [
        { to: USDC_BASE, data: approveData },
        { to: MEGAPOT_JACKPOT, data: buyData },
      ],
      sponsored: true,
    });

    const status = await account.waitForExecution(result);
    this.logger.log(`Rhinestone custom buy complete: ${safeJson(status)}`);
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
      const msg: string = simErr.message ?? '';
      // RPC-level errors (rate limit, timeout, network) are not contract reverts —
      // skip the dry-run and let Rhinestone's own infrastructure attempt the tx.
      const isRpcError = msg.includes('over rate limit') || msg.includes('RPC Request failed') ||
                         msg.includes('timeout') || msg.includes('429');
      if (isRpcError) {
        this.logger.warn(`Rhinestone: dry-run skipped (RPC error, not a revert): ${msg.slice(0, 120)}`);
      } else {
        this.logger.warn(`Rhinestone: dry-run revert from ${smartAcctAddress}: ${msg.slice(0, 200)}`);
        throw simErr;
      }
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
