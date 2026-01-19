import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encodeFunctionData } from 'viem';

// TicketAutomator contract ABI
const TICKET_AUTOMATOR_ABI = [
  {
    name: 'buyTicketsWithLoan',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'receiver', type: 'address' },
      { name: 'refCode', type: 'bytes32' },
    ],
    outputs: [
      { name: 'ticketCount', type: 'uint256' },
      { name: 'ethBackAmount', type: 'uint256' },
    ],
  },
] as const;

// Default contract address on Base
const DEFAULT_TICKET_AUTOMATOR = '0xd1950a138328b52da4fe73dbdb167a83f2c83db9';

// Loofta referral code (bytes32)
const LOOFTA_REF_CODE = '0x4c4f4f4654410000000000000000000000000000000000000000000000000000' as `0x${string}`;

export interface LotteryDepositRequest {
  recipientAddress: string;
  numTickets: number;
  fromToken: {
    symbol: string;
    chain: string;
    tokenId: string;
    decimals: number;
  };
  amount: string;
}

export interface LotteryDepositResult {
  depositAddress?: string;
  memo?: string | null;
  deadline?: string;
  timeEstimate?: number;
  quoteId?: string;
  minAmountInFormatted?: string;
  contractAddress: string;
  calldata: string;
  error?: string;
}

@Injectable()
export class LotteryService {
  private readonly logger = new Logger(LotteryService.name);
  private readonly ticketAutomatorAddress: string;

  constructor(private readonly configService: ConfigService) {
    this.ticketAutomatorAddress = this.configService.get<string>(
      'TICKET_AUTOMATOR_ADDRESS',
      DEFAULT_TICKET_AUTOMATOR,
    );
  }

  /**
   * Get the ticket automator contract address
   */
  getContractAddress(): string {
    return this.ticketAutomatorAddress;
  }

  /**
   * Encode ticket purchase calldata
   */
  encodeTicketPurchase(recipientAddress: string): string {
    this.logger.debug(`Encoding ticket purchase for recipient: ${recipientAddress}`);

    const calldata = encodeFunctionData({
      abi: TICKET_AUTOMATOR_ABI,
      functionName: 'buyTicketsWithLoan',
      args: [recipientAddress as `0x${string}`, LOOFTA_REF_CODE],
    });

    this.logger.debug(`Calldata encoded: ${calldata.slice(0, 20)}...`);
    return calldata;
  }

  /**
   * Calculate estimated tickets for ETH amount
   * Based on current ticket price (~0.0005 ETH per ticket)
   */
  estimateTickets(ethAmount: number): number {
    const TICKET_PRICE_ETH = 0.0005;
    return Math.floor(ethAmount / TICKET_PRICE_ETH);
  }

  /**
   * Calculate ETH needed for ticket count
   */
  calculateEthNeeded(numTickets: number): number {
    const TICKET_PRICE_ETH = 0.0005;
    const ETH_BUFFER = 1.05; // 5% buffer for gas
    return numTickets * TICKET_PRICE_ETH * ETH_BUFFER;
  }

  /**
   * Validate recipient address
   */
  validateRecipientAddress(address: string): { valid: boolean; error?: string } {
    if (!address) {
      return { valid: false, error: 'Recipient address is required' };
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return { valid: false, error: 'Invalid Ethereum address format' };
    }

    return { valid: true };
  }

  /**
   * Get lottery contract info
   */
  getContractInfo(): {
    address: string;
    chain: string;
    chainId: number;
    abi: typeof TICKET_AUTOMATOR_ABI;
    referralCode: string;
  } {
    return {
      address: this.ticketAutomatorAddress,
      chain: 'base',
      chainId: 8453,
      abi: TICKET_AUTOMATOR_ABI,
      referralCode: LOOFTA_REF_CODE,
    };
  }
}
