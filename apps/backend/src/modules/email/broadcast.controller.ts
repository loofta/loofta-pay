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

  /**
   * Supabase/PostgREST caps unbounded selects at 1000 rows by default — a plain
   * `.select('email')` silently truncates any table past that, undercounting broadcast
   * recipients with no error. Page through in batches instead of relying on a bare select.
   */
  private async fetchAllEmails(
    table: 'appUsers' | 'mainnetWaitlist',
  ): Promise<string[]> {
    const PAGE = 1000;
    const emails: string[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.supabaseService[table]
        .select('email')
        .not('email', 'is', null)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
      for (const row of data ?? []) {
        const e = (row.email as string | null)?.trim().toLowerCase();
        if (e) emails.push(e);
      }
      if (!data || data.length < PAGE) break;
    }
    return emails;
  }

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
      const [userEmails, waitlistEmails] = await Promise.all([
        this.fetchAllEmails('appUsers'),
        this.fetchAllEmails('mainnetWaitlist'),
      ]);
      recipients = Array.from(new Set([...userEmails, ...waitlistEmails]));
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

  /**
   * lottery_tickets.user_id stores the Privy DID, not app_users.id — join through
   * app_users.privy_user_id instead. Paginate both the ticket scan and the app_users lookup;
   * PostgREST caps unbounded selects/`.in()` filters, so a single query would silently
   * under-cover a growing player base.
   */
  private async fetchMegapotPlayerEmails(): Promise<string[]> {
    const db = this.supabaseService.getClient();
    const PAGE = 1000;
    const userIds = new Set<string>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('lottery_tickets')
        .select('user_id')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`Failed to fetch lottery_tickets: ${error.message}`);
      for (const row of data ?? []) if (row.user_id) userIds.add(row.user_id);
      if (!data || data.length < PAGE) break;
    }

    const ids = Array.from(userIds);
    const emails = new Set<string>();
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await this.supabaseService.appUsers
        .select('email')
        .in('privy_user_id', ids.slice(i, i + CHUNK))
        .not('email', 'is', null);
      if (error) throw new Error(`Failed to fetch app_users: ${error.message}`);
      for (const row of data ?? []) {
        const e = (row.email as string | null)?.trim().toLowerCase();
        if (e) emails.add(e);
      }
    }
    return Array.from(emails);
  }

  @Post('megapot-results-fix')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast the Megapot results-check bug fix to everyone who has played Megapot. Pass testEmail to dry-run to one address.' })
  async broadcastMegapotResultsFix(@Body() body: { testEmail?: string }) {
    const { testEmail } = body ?? {};

    let recipients: string[];

    if (testEmail) {
      recipients = [testEmail.trim().toLowerCase()];
      this.logger.log(`Megapot results-fix broadcast: TEST MODE — sending only to ${testEmail}`);
    } else {
      recipients = await this.fetchMegapotPlayerEmails();
      this.logger.log(`Megapot results-fix broadcast: ${recipients.length} unique recipients (Megapot players only)`);
    }

    let sent = 0;
    let failed = 0;

    for (const email of recipients) {
      try {
        await this.emailService.sendMegapotResultsFixEmail(email);
        sent++;
      } catch {
        failed++;
        this.logger.warn(`Failed to send Megapot results-fix email to ${email}`);
      }
    }

    this.logger.log(`Megapot results-fix broadcast complete: ${sent} sent, ${failed} failed`);
    return { ok: true, sent, failed, total: recipients.length };
  }

  @Post('megapot-launch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast Megapot $1,000 giveaway email. Pass testEmail to dry-run to one address.' })
  async broadcastMegapotLaunch(@Body() body: { testEmail?: string }) {
    const { testEmail } = body ?? {};

    let recipients: string[];

    if (testEmail) {
      recipients = [testEmail.trim().toLowerCase()];
      this.logger.log(`Megapot launch broadcast: TEST MODE — sending only to ${testEmail}`);
    } else {
      recipients = Array.from(new Set(await this.fetchAllEmails('appUsers')));
      this.logger.log(`Megapot launch broadcast: ${recipients.length} unique recipients (app users)`);
    }

    let sent = 0;
    let failed = 0;

    for (const email of recipients) {
      try {
        await this.emailService.sendMegapotLaunchEmail(email);
        sent++;
      } catch {
        failed++;
        this.logger.warn(`Failed to send Megapot launch email to ${email}`);
      }
    }

    this.logger.log(`Megapot launch broadcast complete: ${sent} sent, ${failed} failed`);
    return { ok: true, sent, failed, total: recipients.length };
  }
}
