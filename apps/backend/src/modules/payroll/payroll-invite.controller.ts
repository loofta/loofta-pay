import { Controller, Get, Post, Body, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { PayrollContributorsService, InviteInfo } from './payroll-contributors.service';
import { OnboardContributorDto } from './dto';

@ApiTags('payroll/invite')
@Controller('payroll/invite')
export class PayrollInviteController {
  constructor(private readonly contributorsService: PayrollContributorsService) {}

  /**
   * Get invite details by token (public — for invite landing page)
   */
  @Get(':token')
  @ApiOperation({ summary: 'Get invite details by token' })
  @ApiParam({ name: 'token', description: 'Invite token from link' })
  @ApiResponse({ status: 200, description: 'Invite details' })
  @ApiResponse({ status: 404, description: 'Invalid or expired invite' })
  async getInvite(@Param('token') token: string): Promise<InviteInfo> {
    const invite = await this.contributorsService.getInviteByToken(token);
    if (!invite) throw new NotFoundException('Invalid or expired invite link');
    return invite;
  }

  /**
   * Complete onboarding (set destination wallet + optional username)
   */
  @Post(':token/onboard')
  @ApiOperation({ summary: 'Complete onboarding via invite token' })
  @ApiParam({ name: 'token', description: 'Invite token from link' })
  @ApiResponse({ status: 200, description: 'Contributor updated' })
  @ApiResponse({ status: 400, description: 'Invalid wallet or input' })
  @ApiResponse({ status: 404, description: 'Invalid or expired invite' })
  async onboard(@Param('token') token: string, @Body() dto: OnboardContributorDto) {
    return this.contributorsService.onboardByToken(token, dto);
  }
}
