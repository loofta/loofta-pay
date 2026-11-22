import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard, Public, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { SupportChatService } from './support-chat.service';

class SendMessageDto {
  @IsOptional() @IsString() @MaxLength(500) text?: string;
  @IsOptional() @IsString() @MaxLength(40) faq?: string;
  @IsOptional() @IsBoolean() human?: boolean;
  @IsOptional() @IsString() @MaxLength(64) org_id?: string;
}

/** The chat on the withdraw page. Signed-in people only, and each person can only ever read their own thread. */
@ApiTags('support')
@Controller('support')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class SupportChatController {
  constructor(private readonly support: SupportChatService) {}

  @Get('faq')
  @Public()
  @RateLimit(60, 60, 'support:faq')
  faq() {
    return { questions: this.support.faq() };
  }

  @Get('messages')
  @RateLimit(60, 60, 'support:messages')
  messages(@PrivyUser() user: { id: string }, @Query('after') after?: string) {
    return this.support.messages(user.id, after);
  }

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'support:send')
  send(@PrivyUser() user: { id: string }, @Body() dto: SendMessageDto) {
    return this.support.send(user.id, { text: dto.text, faq: dto.faq, human: dto.human, orgId: dto.org_id });
  }
}
