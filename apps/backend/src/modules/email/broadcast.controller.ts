import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AdminGuard } from '@/common/guards';
import { EmailService } from './email.service';
import { SupabaseService } from '@/database/supabase.service';

@ApiTags('admin/broadcast')
@Controller('admin/broadcast')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class BroadcastController {
  private readonly logger = new Logger(BroadcastController.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Post('mainnet-launch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast mainnet launch email. Pass testEmail to dry-run to one address.' })
  async broadcastMainnetLaunch(@Body() body: { testEmail?: string }) {
    const { testEmail } = body ?? {};

    let recipients: string[];

    if (testEmail) {
      recipients = [testEmail.trim().toLowerCase()];
      this.logger.log(`Mainnet launch broadcast: TEST MODE — sending only to ${testEmail}`);
    } else {
      const [usersResult, waitlistResult] = await Promise.all([
        this.supabaseService.appUsers.select('email').not('email', 'is', null),
        this.supabaseService.mainnetWaitlist.select('email').not('email', 'is', null),
      ]);

      if (usersResult.error) {
        this.logger.error('Failed to fetch app users for broadcast:', usersResult.error);
        throw new Error('Failed to fetch users: ' + usersResult.error.message);
      }
      if (waitlistResult.error) {
        this.logger.error('Failed to fetch waitlist for broadcast:', waitlistResult.error);
        throw new Error('Failed to fetch waitlist: ' + waitlistResult.error.message);
      }

      const emailSet = new Set<string>();
      for (const u of [...(usersResult.data || []), ...(waitlistResult.data || [])]) {
        const e = (u.email as string | null)?.trim().toLowerCase();
        if (e) emailSet.add(e);
      }
      recipients = Array.from(emailSet);
      this.logger.log(`Mainnet launch broadcast: ${recipients.length} unique recipients (users + waitlist, deduplicated)`);
    }

    let sent = 0;
    let failed = 0;

    for (const email of recipients) {
      try {
        await this.emailService.sendMainnetLaunchEmail(email);
        sent++;
      } catch {
        failed++;
        this.logger.warn(`Failed to send mainnet launch email to ${email}`);
      }
    }

    this.logger.log(`Mainnet launch broadcast complete: ${sent} sent, ${failed} failed`);
    return { ok: true, sent, failed, total: recipients.length };
  }
}
