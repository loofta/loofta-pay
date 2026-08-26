import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IntegratorsService } from '@/modules/integrators/integrators.service';
import { REQUIRE_SCOPE_KEY } from '@/common/decorators/require-scope.decorator';

/**
 * Multi-tenant successor to the twitter-payments module's old BotGuard, which checked one
 * static shared secret with no per-caller identity, scope, rate limit, or revocation. This
 * hashes the incoming bearer key and looks up the specific, individually-revocable integrator it
 * belongs to, attaching it to the request for downstream rate limiting and payment attribution.
 */
@Injectable()
export class IntegratorGuard implements CanActivate {
  constructor(
    private readonly integrators: IntegratorsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const auth = request.headers['authorization'] as string | undefined;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing integrator API key');
    }
    const rawKey = auth.slice('Bearer '.length).trim();
    if (!rawKey) {
      throw new UnauthorizedException('Missing integrator API key');
    }

    const integrator = await this.integrators.findActiveByRawKey(rawKey);
    if (!integrator) {
      throw new UnauthorizedException('Invalid or revoked integrator API key');
    }

    const requiredScope = this.reflector.get<string | undefined>(REQUIRE_SCOPE_KEY, context.getHandler());
    if (requiredScope && !integrator.scopes.includes(requiredScope)) {
      throw new ForbiddenException(`This API key is not scoped for '${requiredScope}'`);
    }

    request.integrator = integrator;
    return true;
  }
}
