import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { AgentAuthService, type AgentSession } from './agent-auth.service';
import { AgentPaymentsService } from './agent-payments.service';
import { AgentGuard } from './agent.guard';
import { StartLoginDto, TokenRequestDto, UserCodeDto, ApproveLoginDto, QuoteDto } from './agent.dto';

const clientIp = (req: any) => String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim() || undefined;

/**
 * Three audiences, kept apart on purpose:
 *  - /agent/auth/device and /agent/auth/token: the agent logging in (no credentials yet, IP rate limited).
 *  - /agent/auth/* and /agent/sessions, /agent/actions: the person, signed in to the app.
 *  - /agent/v1/*: the agent, with its session token.
 */
@ApiExcludeController()
@Controller('agent')
export class AgentController {
  constructor(
    private readonly auth: AgentAuthService,
    private readonly payments: AgentPaymentsService,
  ) {}

  // ----- The agent logging in

  @Post('auth/device')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60, 'agent:device', 'ip')
  startLogin(@Body() dto: StartLoginDto, @Req() req: any) {
    return this.auth.startDevice({ label: dto.label, scopes: dto.scopes, ip: clientIp(req), userAgent: req.headers['user-agent'] });
  }

  @Post('auth/token')
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 60, 'agent:token', 'ip')
  async collectToken(@Body() dto: TokenRequestDto, @Res() res: any) {
    const r = await this.auth.pollToken(dto.device_code);
    if (r.status !== 'approved') return res.status(400).json({ error: r.status });
    return res.status(200).json({
      access_token: r.accessToken,
      token_type: 'Bearer',
      expires_at: r.session.expiresAt,
      scopes: r.session.scopes,
      limits: { per_payment_cap_usd: r.session.perPaymentCapUsd, daily_cap_usd: r.session.dailyCapUsd, auto_approve_usd: r.session.autoApproveUsd },
    });
  }

  // ----- The person, in the app

  @Post('auth/describe')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'agent:describe')
  describe(@Body() dto: UserCodeDto) {
    return this.auth.describeDevice(dto.user_code);
  }

  @Post('auth/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'agent:approve')
  async approve(@PrivyUser() user: { id: string }, @Body() dto: ApproveLoginDto) {
    const s = await this.auth.approveDevice(user.id, dto.user_code, {
      label: dto.label, scopes: dto.scopes, perPaymentCapUsd: dto.per_payment_cap_usd, dailyCapUsd: dto.daily_cap_usd,
      autoApproveUsd: dto.auto_approve_usd, expiresInDays: dto.expires_in_days,
    });
    return { id: s.id, label: s.label, scopes: s.scopes, expires_at: s.expiresAt };
  }

  @Post('auth/deny')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'agent:deny')
  async deny(@Body() dto: UserCodeDto) {
    await this.auth.denyDevice(dto.user_code);
    return { ok: true };
  }

  @Get('sessions')
  @UseGuards(AuthGuard)
  sessions(@PrivyUser() user: { id: string }) {
    return this.auth.listSessions(user.id);
  }

  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'agent:revoke')
  async revoke(@PrivyUser() user: { id: string }, @Param('id') id: string) {
    await this.auth.revokeSession(user.id, id);
    return { ok: true };
  }

  @Get('actions/:id')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(60, 60, 'agent:action-get')
  action(@PrivyUser() user: { id: string }, @Param('id') id: string) {
    return this.payments.getForUser(user.id, id);
  }

  @Post('actions/:id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'agent:action-approve')
  approveAction(@PrivyUser() user: { id: string }, @Param('id') id: string) {
    return this.payments.approve(user.id, id);
  }

  @Post('actions/:id/deny')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'agent:action-deny')
  denyAction(@PrivyUser() user: { id: string }, @Param('id') id: string) {
    return this.payments.deny(user.id, id);
  }

  // ----- The agent, with its token

  @Get('v1/me')
  @UseGuards(AgentGuard, RateLimitGuard)
  @RateLimit(60, 60, 'agent:me')
  me(@Req() req: { agentSession: AgentSession }) {
    return this.payments.me(req.agentSession);
  }

  @Get('v1/contacts')
  @UseGuards(AgentGuard, RateLimitGuard)
  @RateLimit(60, 60, 'agent:contacts')
  contacts(@Req() req: { agentSession: AgentSession }, @Query('limit') limit?: string) {
    return this.payments.contacts(req.agentSession, limit ? Number(limit) : 30);
  }

  @Get('v1/lookup')
  @UseGuards(AgentGuard, RateLimitGuard)
  @RateLimit(60, 60, 'agent:lookup')
  lookup(@Req() req: { agentSession: AgentSession }, @Query('recipient') recipient: string) {
    return this.payments.lookup(req.agentSession, recipient);
  }

  @Post('v1/quote')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AgentGuard, RateLimitGuard)
  @RateLimit(60, 60, 'agent:quote')
  quote(@Req() req: { agentSession: AgentSession }, @Body() dto: QuoteDto) {
    return this.payments.quote(req.agentSession, dto);
  }

  @Post('v1/payments')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AgentGuard, RateLimitGuard)
  @RateLimit(20, 60, 'agent:pay')
  pay(@Req() req: { agentSession: AgentSession }, @Body() dto: QuoteDto, @Headers('idempotency-key') key: string) {
    return this.payments.pay(req.agentSession, dto, key);
  }

  @Get('v1/payments')
  @UseGuards(AgentGuard, RateLimitGuard)
  @RateLimit(60, 60, 'agent:list')
  list(@Req() req: { agentSession: AgentSession }, @Query('limit') limit?: string) {
    return this.payments.list(req.agentSession, limit ? Number(limit) : 20);
  }

  @Get('v1/payments/:id')
  @UseGuards(AgentGuard, RateLimitGuard)
  @RateLimit(120, 60, 'agent:get')
  get(@Req() req: { agentSession: AgentSession }, @Param('id') id: string) {
    return this.payments.get(req.agentSession, id);
  }
}
