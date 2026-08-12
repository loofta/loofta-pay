import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { TwitterAutopayService } from './twitter-autopay.service';

/**
 * All routes require just AuthGuard (any logged-in user), not AdminGuard — status needs to be
 * checkable by non-admins too (that's how the frontend decides to show the "request access"
 * message vs. the real settings). Real authorization for enroll/unenroll happens inside the
 * service (assertAdmin), same pattern as GiveawaysService's "create as Loofta" inline check.
 */
@ApiTags('twitter-autopay')
@Controller('twitter-autopay')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class TwitterAutopayController {
  constructor(private readonly autopay: TwitterAutopayService) {}

  @Get('status')
  @ApiOperation({ summary: 'Current user\'s Twitter auto-pay enrollment status + whether they can see the settings at all' })
  async status(@PrivyUser() user: { id: string }) {
    return this.autopay.getStatus(user.id);
  }

  @Post('enroll')
  @ApiOperation({ summary: 'Admin-only: enable Twitter auto-pay after granting the Privy authorization key' })
  async enroll(@PrivyUser() user: { id: string }) {
    return this.autopay.enroll(user.id);
  }

  @Post('unenroll')
  @ApiOperation({ summary: 'Admin-only: disable Twitter auto-pay' })
  async unenroll(@PrivyUser() user: { id: string }) {
    return this.autopay.unenroll(user.id);
  }
}
