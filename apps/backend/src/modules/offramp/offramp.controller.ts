import {
  Controller, Post, Get, Body, Param, Req,
  UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { OfframpService } from './offramp.service';
import { CreateOfframpDto } from './dto/create-offramp.dto';

@ApiTags('offramp')
@Controller('offramp')
export class OfframpController {
  constructor(private readonly offramp: OfframpService) {}

  @Post('prepare')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Prepare a Peer offramp — returns Near Intents bridge address to Base' })
  async prepare(@Req() req: any, @Body() dto: CreateOfframpDto) {
    if (!dto.platform || !dto.identifier || !dto.solanaAddress || !(dto.amountUSDC > 0)) {
      throw new BadRequestException('platform, identifier, solanaAddress, and amountUSDC are required');
    }
    return this.offramp.prepareOfframp(req.user.id, dto);
  }

  @Post(':id/confirm-bridge')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark that the Solana→Base bridge tx has been sent' })
  async confirmBridge(@Req() req: any, @Param('id') id: string) {
    return this.offramp.confirmBridge(id, req.user.id);
  }

  @Post(':id/create-deposit')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create ZKP2P deposit on Base (called once USDC has arrived)' })
  async createDeposit(@Req() req: any, @Param('id') id: string) {
    return this.offramp.createZkp2pDeposit(id, req.user.id);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Get offramp status' })
  async getStatus(@Req() req: any, @Param('id') id: string) {
    return this.offramp.getStatus(id, req.user.id);
  }

  @Post(':id/cancel')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel offramp — withdraws ZKP2P deposit and bridges USDC back to Solana' })
  async cancel(@Req() req: any, @Param('id') id: string) {
    return this.offramp.cancelOfframp(id, req.user.id);
  }
}
