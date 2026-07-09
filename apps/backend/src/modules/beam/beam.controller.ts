import {
  Controller, Post, Get, Body, Param, Req,
  UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { BeamService } from './beam.service';
import { CreateBeamDto } from './dto/create-beam.dto';

@ApiTags('beam')
@Controller('beam')
export class BeamController {
  constructor(private readonly beam: BeamService) {}

  @Post()
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Create a Loofta Beam payment — sender pays USDC on Base, recipient gets Venmo/Cash App/Revolut' })
  async create(@Req() req: any, @Body() dto: CreateBeamDto) {
    if (!dto.platform || !dto.identifier || !dto.baseWalletAddress || !(dto.amountUSDC > 0)) {
      throw new BadRequestException('platform, identifier, baseWalletAddress, and amountUSDC are required');
    }
    return this.beam.createBeam(req.user.id, dto);
  }

  @Post(':id/confirm-funded')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark that the Base wallet has been funded for this payment' })
  async confirmFunded(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { fundingMethod: string; fundingReference?: string },
  ) {
    if (!body.fundingMethod) throw new BadRequestException('fundingMethod is required');
    return this.beam.confirmFunded(id, req.user.id, body.fundingMethod, body.fundingReference ?? null);
  }

  @Post(':id/record-deposit')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record the ZKP2P deposit created by the user\'s Base wallet' })
  async recordDeposit(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { depositId?: string; txHash?: string },
  ) {
    return this.beam.recordDeposit(id, req.user.id, body.depositId ?? null, body.txHash ?? null);
  }

  @Post(':id/cancel')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a Beam payment that was started but never actually funded' })
  async cancel(@Req() req: any, @Param('id') id: string) {
    return this.beam.cancelBeam(id, req.user.id);
  }

  @Get(':id/lock-state')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Check whether a deposited payment is still cancellable (no peer has claimed it yet)' })
  async getLockState(@Req() req: any, @Param('id') id: string) {
    return this.beam.getLockState(id, req.user.id);
  }

  @Post(':id/mark-cancelled')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a payment cancelled after the frontend signed the on-chain withdrawal' })
  async markCancelled(@Req() req: any, @Param('id') id: string) {
    return this.beam.markCancelled(id, req.user.id);
  }

  @Get('history')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Get the current user\'s Beam payment history' })
  async getHistory(@Req() req: any) {
    return this.beam.getHistory(req.user.id);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Get Beam payment status' })
  async getStatus(@Req() req: any, @Param('id') id: string) {
    return this.beam.getStatus(id, req.user.id);
  }
}
