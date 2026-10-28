import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AgentAuthService } from './agent-auth.service';

/** Reads `Authorization: Bearer lft_ag_...`, finds the live session it belongs to, and attaches it to the request. */
@Injectable()
export class AgentGuard implements CanActivate {
  constructor(private readonly auth: AgentAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'] as string | undefined;
    const raw = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!raw) throw new UnauthorizedException({ code: 'not_logged_in', message: 'Missing session token. Run `loofta login`.' });
    const session = await this.auth.verifyToken(raw);
    if (!session) throw new UnauthorizedException({ code: 'session_invalid', message: 'This session is expired or was revoked. Run `loofta login` again.' });
    request.agentSession = session;
    return true;
  }
}
