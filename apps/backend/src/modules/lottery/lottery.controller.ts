import { Controller, Get, Post, Body, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { LotteryService } from './lottery.service';

class EncodeTicketPurchaseDto {
  recipientAddress: string;
}

class EstimateTicketsDto {
  ethAmount: number;
}

@ApiTags('lottery')
@Controller('lottery')
export class LotteryController {
  constructor(private readonly lotteryService: LotteryService) {}

  /**
   * Get contract info
   */
  @Get('contract')
  @ApiOperation({ summary: 'Get lottery contract information' })
  @ApiResponse({ status: 200, description: 'Contract information' })
  getContractInfo() {
    return this.lotteryService.getContractInfo();
  }

  /**
   * Encode ticket purchase calldata
   */
  @Post('encode')
  @ApiOperation({ summary: 'Encode ticket purchase calldata' })
  @ApiResponse({ status: 200, description: 'Encoded calldata' })
  encodeTicketPurchase(
    @Body() dto: EncodeTicketPurchaseDto,
  ): { calldata: string; contractAddress: string } {
    const validation = this.lotteryService.validateRecipientAddress(dto.recipientAddress);
    if (!validation.valid) {
      throw new BadRequestException(validation.error);
    }

    const calldata = this.lotteryService.encodeTicketPurchase(dto.recipientAddress);
    const contractAddress = this.lotteryService.getContractAddress();

    return { calldata, contractAddress };
  }

  /**
   * Estimate tickets for ETH amount
   */
  @Get('estimate')
  @ApiOperation({ summary: 'Estimate tickets for ETH amount' })
  @ApiQuery({ name: 'ethAmount', description: 'ETH amount', type: 'number' })
  @ApiResponse({ status: 200, description: 'Estimated ticket count' })
  estimateTickets(@Query('ethAmount') ethAmount: string): {
    ethAmount: number;
    estimatedTickets: number;
  } {
    const amount = parseFloat(ethAmount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('Invalid ETH amount');
    }

    const estimatedTickets = this.lotteryService.estimateTickets(amount);
    return { ethAmount: amount, estimatedTickets };
  }

  /**
   * Calculate ETH needed for ticket count
   */
  @Get('calculate-eth')
  @ApiOperation({ summary: 'Calculate ETH needed for ticket count' })
  @ApiQuery({ name: 'tickets', description: 'Number of tickets', type: 'number' })
  @ApiResponse({ status: 200, description: 'ETH needed' })
  calculateEthNeeded(@Query('tickets') tickets: string): {
    tickets: number;
    ethNeeded: number;
  } {
    const numTickets = parseInt(tickets, 10);
    if (isNaN(numTickets) || numTickets <= 0) {
      throw new BadRequestException('Invalid ticket count');
    }

    const ethNeeded = this.lotteryService.calculateEthNeeded(numTickets);
    return { tickets: numTickets, ethNeeded };
  }
}
