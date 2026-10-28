import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { AgentOauthService, OAuthError } from './agent-oauth.service';

/** Where this API is reached from outside, for the addresses published in the OAuth metadata. */
export function publicBase(config: ConfigService, req: any): string {
  const fixed = config.get<string>('PUBLIC_API_URL');
  if (fixed) return fixed.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim();
  return `${proto}://${String(req.headers['x-forwarded-host'] ?? req.headers.host).split(',')[0].trim()}`;
}

@ApiExcludeController()
@Controller()
export class AgentOauthController {
  constructor(
    private readonly oauth: AgentOauthService,
    private readonly config: ConfigService,
  ) {}

  private get appUrl() {
    return (this.config.get<string>('NEXT_PUBLIC_APP_URL') || this.config.get<string>('NEXT_PUBLIC_BASE_URL') || 'https://pay.loofta.xyz').replace(/\/$/, '');
  }

  // ----- What an MCP client reads to find out how to log in

  // Clients look for the metadata both at the root and with the resource path appended (RFC 9728).
  @Get(['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/mcp'])
  protectedResource(@Req() req: any) {
    const base = publicBase(this.config, req);
    return { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'], scopes_supported: ['read', 'pay'] };
  }

  @Get(['.well-known/oauth-authorization-server', '.well-known/oauth-authorization-server/mcp', '.well-known/openid-configuration'])
  authorizationServer(@Req() req: any) {
    const base = publicBase(this.config, req);
    return {
      issuer: base,
      authorization_endpoint: `${this.appUrl}/agent/authorize`, // the Loofta app shows the consent screen
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'pay'],
    };
  }

  // ----- The client

  @Post('oauth/register')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60, 'agent:oauth-register', 'ip')
  async register(@Body() body: any, @Res() res: any) {
    try {
      return res.status(201).json(await this.oauth.register(body ?? {}));
    } catch (e) {
      if (e instanceof OAuthError) return res.status(400).json({ error: 'invalid_client_metadata', error_description: e.message });
      throw e;
    }
  }

  @Post('oauth/token')
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 60, 'agent:oauth-token', 'ip')
  async token(@Body() body: any, @Res() res: any) {
    res.set('Cache-Control', 'no-store');
    try {
      return res.status(200).json(await this.oauth.exchange(body ?? {}));
    } catch (e) {
      if (e instanceof OAuthError) return res.status(400).json({ error: e.code, error_description: e.message });
      throw e;
    }
  }

  // ----- The person, in the app

  @Post('agent/oauth/describe')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(30, 60, 'agent:oauth-describe')
  describe(@Body() b: { client_id: string; redirect_uri: string }) {
    return this.oauth.describe(String(b?.client_id ?? ''), String(b?.redirect_uri ?? ''));
  }

  @Post('agent/oauth/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'agent:oauth-approve')
  approve(@PrivyUser() user: { id: string }, @Req() req: any, @Body() b: any) {
    return this.oauth.approve(user.id, {
      clientId: String(b?.client_id ?? ''),
      redirectUri: String(b?.redirect_uri ?? ''),
      codeChallenge: String(b?.code_challenge ?? ''),
      codeChallengeMethod: b?.code_challenge_method,
      state: b?.state ? String(b.state).slice(0, 500) : undefined,
      ip: String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim() || undefined,
      limits: {
        perPaymentCapUsd: b?.per_payment_cap_usd, dailyCapUsd: b?.daily_cap_usd, autoApproveUsd: b?.auto_approve_usd, expiresInDays: b?.expires_in_days,
      },
    });
  }
}
