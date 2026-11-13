import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '@/common/guards';
import { MiniCalloutsService } from './mini-callouts.service';

/** Paying posters their callout earnings. Admins only. */
@ApiTags('admin-callouts')
@Controller('admin/callouts')
@UseGuards(AdminGuard)
export class MiniCalloutsAdminController {
  constructor(private readonly callouts: MiniCalloutsService) {}

  @Get('pending')
  @ApiOperation({ summary: 'Who is owed callout earnings, with their wallet' })
  pending() {
    return this.callouts.pendingByCaller();
  }

  @Post('paid')
  @ApiOperation({ summary: 'Mark everything pending for a poster as paid, with the transaction that paid it' })
  paid(@Body() body: { callerId?: string; signature?: string }) {
    return this.callouts.markPaid(String(body?.callerId ?? ''), String(body?.signature ?? ''));
  }
}
