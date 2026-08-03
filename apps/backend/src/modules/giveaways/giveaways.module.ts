import { Module } from '@nestjs/common';
import { ClaimsModule } from '../claims/claims.module';
import { SendPaymentModule } from '../send-payment/send-payment.module';
import { EmailModule } from '../email/email.module';
import { IntentsModule } from '../intents/intents.module';
import { UsersModule } from '../users/users.module';
import { GiveawaysController } from './giveaways.controller';
import { GiveawaysAdminController } from './giveaways-admin.controller';
import { GiveawaysPublicController } from './giveaways-public.controller';
import { GiveawaysService } from './giveaways.service';
import { GiveawayBurnerSweepService } from './giveaway-burner-sweep.service';
import { GiveawayFundingService } from './giveaway-funding.service';
import { XVerificationService } from './x-verification.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { GiveawayDrawService } from './giveaway-draw.service';
import { GiveawayPayoutService } from './giveaway-payout.service';
import { GiveawayCronService } from './giveaway-cron.service';

@Module({
  imports: [ClaimsModule, SendPaymentModule, EmailModule, IntentsModule, UsersModule],
  // GiveawaysPublicController and GiveawaysAdminController MUST both be registered before
  // GiveawaysController. GiveawaysController's `:id`-based routes (`GET /giveaways/:id`,
  // `GET /giveaways/:id/review-queue`, etc.) happily match "public" or "admin" as the literal
  // `:id` segment — e.g. `/giveaways/admin/review-queue` matched `:id/review-queue` with
  // id="admin" and hit AuthGuard/findOneForCreator instead of GiveawaysAdminController,
  // producing "invalid input syntax for type uuid: admin". Same class of bug
  // organizations.controller.ts's `mine`-before-`:id` comment warns about, just across
  // controllers instead of within one — always register the more specific literal-prefixed
  // controller first.
  controllers: [GiveawaysPublicController, GiveawaysAdminController, GiveawaysController],
  providers: [
    GiveawaysService,
    GiveawayBurnerSweepService,
    GiveawayFundingService,
    XVerificationService,
    GiveawayEntriesService,
    GiveawayDrawService,
    GiveawayPayoutService,
    GiveawayCronService,
  ],
  exports: [
    GiveawaysService,
    GiveawayBurnerSweepService,
    GiveawayFundingService,
    XVerificationService,
    GiveawayEntriesService,
    GiveawayDrawService,
    GiveawayPayoutService,
  ],
})
export class GiveawaysModule {}
