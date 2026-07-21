import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { IntegratorsService } from '@/modules/integrators/integrators.service';

/**
 * Multi-tenant successor to the twitter-payments module's old BotGuard, which checked one
 * static shared secret with no per-caller identity, scope, rate limit, or revocation. This
 * hashes the incoming bearer key and looks up the specific, individually-revocable integrator it
 * belongs to, attaching it to the request for downstream rate limiting and payment attribution.
 */
@Injectable()
export class IntegratorGuard implements CanActivate {
  constructor(private readonly integrators: IntegratorsService) {}

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

    request.integrator = integrator;
    return true;
  }
}
