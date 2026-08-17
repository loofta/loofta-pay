import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GiveawaysService } from './giveaways.service';

/** Guards every route under /giveaways/review-link/:token/* except the password-auth route
 *  itself. Verifies the session token (Authorization: Bearer <sessionToken>) was issued for this
 *  exact :token's giveaway and hasn't expired, then attaches the resolved giveawayId to the
 *  request — every handler must still scope its own queries/mutations to it (see
 *  GiveawayEntriesService.reviewCompletionScoped), this guard only proves "this session may act on
 *  this giveaway," not authorization for any specific completion. */
@Injectable()
export class ReviewLinkGuard implements CanActivate {
  constructor(private readonly giveawaysService: GiveawaysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.params?.token as string | undefined;
    const authHeader = (request.headers['authorization'] as string | undefined)?.trim();
    if (!token || !authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Review session required');

    const sessionToken = authHeader.slice(7).trim();
    const giveawayId = await this.giveawaysService.verifyReviewSessionToken(token, sessionToken);
    request.reviewGiveawayId = giveawayId;
    return true;
  }
}
