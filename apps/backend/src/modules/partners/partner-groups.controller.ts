import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { PartnerGroupsService } from './partner-groups.service';
import { CreateRecipientGroupDto, GroupMembersDto, UpdateRecipientGroupDto } from './dto/partner.dto';

type Caller = { id: string };

/** Recipient groups. Default-deny like the rest of the portal: a verified login, then the caller's role in the company. */
@ApiTags('partners')
@Controller('partners')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class PartnerGroupsController {
  constructor(private readonly groups: PartnerGroupsService) {}

  @Get(':orgId/groups')
  @RateLimit(60, 60, 'partners:groups')
  list(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.groups.list(orgId, user.id);
  }

  @Post(':orgId/groups')
  @RateLimit(20, 60, 'partners:groups:write')
  @ApiOperation({ summary: 'Create a recipient group, optionally linked to a public https URL that returns a JSON or CSV list.' })
  create(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Body() dto: CreateRecipientGroupDto) {
    return this.groups.create(orgId, user.id, dto);
  }

  @Patch(':orgId/groups/:groupId')
  @RateLimit(30, 60, 'partners:groups:write')
  update(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('groupId', ParseUUIDPipe) groupId: string, @Body() dto: UpdateRecipientGroupDto) {
    return this.groups.update(orgId, user.id, groupId, dto);
  }

  @Delete(':orgId/groups/:groupId')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'partners:groups:write')
  remove(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.groups.remove(orgId, user.id, groupId);
  }

  @Get(':orgId/groups/:groupId/members')
  @RateLimit(60, 60, 'partners:groups')
  members(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('groupId', ParseUUIDPipe) groupId: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.groups.members(orgId, user.id, groupId, Number(limit) || 500, Number(offset) || 0);
  }

  @Post(':orgId/groups/:groupId/members')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'partners:groups:write')
  addMembers(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('groupId', ParseUUIDPipe) groupId: string, @Body() dto: GroupMembersDto) {
    return this.groups.addMembers(orgId, user.id, groupId, dto);
  }

  @Delete(':orgId/groups/:groupId/members/:recipientId')
  @HttpCode(HttpStatus.OK)
  @RateLimit(60, 60, 'partners:groups:write')
  removeMember(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('groupId', ParseUUIDPipe) groupId: string, @Param('recipientId', ParseUUIDPipe) recipientId: string) {
    return this.groups.removeMember(orgId, user.id, groupId, recipientId);
  }

  @Post(':orgId/groups/:groupId/sync')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'partners:groups:sync')
  @ApiOperation({ summary: 'Read the group\'s linked URL and make the group match it. At most once a minute per group.' })
  sync(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.groups.sync(orgId, user.id, groupId);
  }
}
