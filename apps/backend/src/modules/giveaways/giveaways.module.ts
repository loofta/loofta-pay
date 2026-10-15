import { Module } from '@nestjs/common';
import { ClaimsModule } from '../claims/claims.module';
import { SendPaymentModule } from '../send-payment/send-payment.module';
import { EmailModule } from '../email/email.module';
import { IntentsModule } from '../intents/intents.module';
import { UsersModule } from '../users/users.module';
import { GiveawaysController } from './giveaways.controller';
import { GiveawaysAdminController } from './giveaways-admin.controller';
import { GiveawaysPublicController } from './giveaways-public.controller';
import { GiveawaysReviewLinkController } from './giveaways-review-link.controller';
import { GiveawaysService } from './giveaways.service';
import { GiveawayBurnerSweepService } from './giveaway-burner-sweep.service';
import { GiveawayFundingService } from './giveaway-funding.service';
import { XVerificationService } from './x-verification.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { GiveawayDrawService } from './giveaway-draw.service';
import { GiveawayVrfService } from './giveaway-vrf.service';
import { GiveawayPayoutService } from './giveaway-payout.service';
import { GiveawayGiphyService } from './giveaway-giphy.service';
import { GiveawayCronService } from './giveaway-cron.service';
import { GiveawayTokenService } from './giveaway-token.service';
import { QuickGiveawayService } from './quick-giveaway.service';
import { QuickRulesParserService } from './quick-rules-parser.service';

@Module({
  imports: [ClaimsModule, SendPaymentModule, EmailModule, IntentsModule, UsersModule],
  // GiveawaysPublicController, GiveawaysAdminController, and GiveawaysReviewLinkController MUST
  // all be registered before GiveawaysController. GiveawaysController's `:id`-based routes
  // (`GET /giveaways/:id`, `GET /giveaways/:id/review-queue`, etc.) happily match "public",
  // "admin", or "review-link" as the literal `:id` segment — e.g. `/giveaways/admin/review-queue`
  // matched `:id/review-queue` with id="admin" and hit AuthGuard/findOneForCreator instead of
  // GiveawaysAdminController, producing "invalid input syntax for type uuid: admin". Same class of
  // bug organizations.controller.ts's `mine`-before-`:id` comment warns about, just across
  // controllers instead of within one — always register the more specific literal-prefixed
  // controller first.
  controllers: [GiveawaysPublicController, GiveawaysAdminController, GiveawaysReviewLinkController, GiveawaysController],
  providers: [
    GiveawaysService,
    GiveawayBurnerSweepService,
    GiveawayFundingService,
    XVerificationService,
    GiveawayEntriesService,
    GiveawayDrawService,
    GiveawayVrfService,
    GiveawayPayoutService,
    GiveawayGiphyService,
    GiveawayCronService,
    GiveawayTokenService,
    QuickGiveawayService,
    QuickRulesParserService,
  ],
  exports: [
    GiveawaysService,
    GiveawayBurnerSweepService,
    GiveawayFundingService,
    XVerificationService,
    GiveawayEntriesService,
    GiveawayDrawService,
    GiveawayVrfService,
    GiveawayPayoutService,
  ],
})
export class GiveawaysModule {}
