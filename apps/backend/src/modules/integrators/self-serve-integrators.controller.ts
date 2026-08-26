import { Controller, Get, Post, Param, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { IntegratorsService } from './integrators.service';

class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }) // require_tld: false so http://localhost:*/logo.png works while testing
  logo_url?: string;
}

/**
 * Self-serve counterpart to admin-integrators.controller.ts — any logged-in Loofta user can mint
 * their own live (mainnet) API key here (scoped to payment_links:create only), no admin
 * provisioning needed. See IntegratorsService.provisionSelfServe.
 */
@ApiTags('integrators')
@Controller('integrators/self-serve')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class SelfServeIntegratorsController {
  constructor(private readonly integrators: IntegratorsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit(5, 60, 'integrators:self-serve-provision')
  @ApiOperation({ summary: 'Provision (or re-mint a key onto) the caller\'s own self-serve integrator' })
  @ApiResponse({ status: 201, description: '{ api_key, key_prefix } — raw key shown once' })
  async provision(@PrivyUser() user: { id: string }) {
    const { rawKey, keyPrefix } = await this.integrators.provisionSelfServe(user.id);
    return { api_key: rawKey, key_prefix: keyPrefix };
  }

  @Get()
  @RateLimit(30, 60, 'integrators:self-serve-status')
  @ApiOperation({ summary: 'Check whether the caller already has a self-serve integrator, and its active keys' })
  async status(@PrivyUser() user: { id: string }) {
    const existing = await this.integrators.findSelfServeByOwner(user.id);
    return {
      provisioned: !!existing,
      keys: (existing?.keys ?? []).map((k) => ({ id: k.id, key_prefix: k.keyPrefix })),
    };
  }

  @Post('rotate')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit(5, 60, 'integrators:self-serve-rotate')
  @ApiOperation({ summary: 'Mint an additional key for the caller\'s own integrator (rotation without a hard cutover)' })
  @ApiResponse({ status: 201, description: '{ api_key, key_prefix } — raw key shown once' })
  async rotate(@PrivyUser() user: { id: string }) {
    const { rawKey, keyPrefix } = await this.integrators.rotateSelfServeKey(user.id);
    return { api_key: rawKey, key_prefix: keyPrefix };
  }

  @Post('keys/:keyId/revoke')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'integrators:self-serve-revoke')
  @ApiOperation({ summary: 'Revoke one of the caller\'s own keys' })
  async revoke(@PrivyUser() user: { id: string }, @Param('keyId') keyId: string) {
    await this.integrators.revokeSelfServeKey(user.id, keyId);
    return { revoked: true };
  }

  @Get('branding')
  @RateLimit(30, 60, 'integrators:self-serve-branding-get')
  @ApiOperation({ summary: 'Get the caller\'s merchant branding (name + logo) shown on payment links they create' })
  async getBranding(@PrivyUser() user: { id: string }) {
    const branding = await this.integrators.getSelfServeBranding(user.id);
    return { name: branding?.name ?? null, logo_url: branding?.logoUrl ?? null };
  }

  @Post('branding')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'integrators:self-serve-branding-update')
  @ApiOperation({ summary: 'Set the caller\'s merchant branding — applies to payment links created after this call, not retroactively' })
  async updateBranding(@PrivyUser() user: { id: string }, @Body() dto: UpdateBrandingDto) {
    const branding = await this.integrators.updateSelfServeBranding(user.id, { name: dto.name, logoUrl: dto.logo_url });
    return { name: branding.name, logo_url: branding.logoUrl };
  }
}
