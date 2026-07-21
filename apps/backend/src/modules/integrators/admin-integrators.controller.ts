import { Controller, Post, Body, Param, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { AdminGuard } from '@/common/guards';
import { IntegratorsService } from './integrators.service';
import { ProvisionIntegratorDto } from './dto/provision-integrator.dto';

/**
 * Internal-only provisioning — no public self-serve integrator signup yet (see the rollout
 * plan: self-serve onboarding is deliberately last, after the trust model + endpoints have real
 * production runtime under a small, hand-picked set of integrators).
 */
@ApiTags('admin/integrators')
@Controller('admin/integrators')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class AdminIntegratorsController {
  constructor(private readonly integrators: IntegratorsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Provision a new integrator + its first API key (raw key returned once)' })
  @ApiResponse({ status: 201, description: '{ integrator_id, api_key, key_prefix }' })
  async provision(@Body() dto: ProvisionIntegratorDto, @Req() req: { user: { id: string } }) {
    const { integratorId, rawKey, keyPrefix } = await this.integrators.provision({
      name: dto.name,
      contactEmail: dto.contact_email,
      isDevnetOnly: dto.is_devnet_only,
      rateLimitPerMin: dto.rate_limit_per_min,
      createdByAdmin: req.user.id,
    });
    return { integrator_id: integratorId, api_key: rawKey, key_prefix: keyPrefix };
  }

  @Post(':id/keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Mint an additional API key for an existing integrator (rotation without a hard cutover)' })
  @ApiResponse({ status: 201, description: '{ api_key, key_prefix }' })
  async mintKey(@Param('id') id: string, @Body() body: { is_devnet_only?: boolean }) {
    const { rawKey, keyPrefix } = await this.integrators.mintAdditionalKey(id, body.is_devnet_only ?? true);
    return { api_key: rawKey, key_prefix: keyPrefix };
  }

  @Post('keys/:keyId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a single integrator API key' })
  async revokeKey(@Param('keyId') keyId: string) {
    await this.integrators.revokeKey(keyId);
    return { revoked: true };
  }
}
