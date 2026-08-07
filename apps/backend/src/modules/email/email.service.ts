import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface ClaimEmailData {
  id: string;
  amount: string | number;
  description?: string | null;
  senderInfo?: string | null;
  recipientEmail: string;
  scheduledAt?: string;
  /** Override the default https://pay.loofta.xyz/c/:id URL (e.g. for /s/ send-payment links). */
  claimUrl?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null = null;
  private readonly fromEmail: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.fromEmail =
      this.configService.get<string>('RESEND_FROM_EMAIL') || 'noreply@loofta.xyz';
    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.log('EmailService initialized');
    } else {
      this.logger.warn('RESEND_API_KEY not set — emails will not be sent');
    }
  }

  isAvailable(): boolean {
    return this.resend !== null;
  }

  async sendPaymentReceivedEmail(data: ClaimEmailData): Promise<void> {
    if (!this.resend) return;
    const amountStr = `$${parseFloat(String(data.amount)).toFixed(2)}`;
    const claimUrl = data.claimUrl
      ? `https://pay.loofta.xyz${new URL(data.claimUrl, 'https://pay.loofta.xyz').pathname}`
      : `https://pay.loofta.xyz/c/${data.id}`;
    const subject = `You received ${amountStr} on Loofta 🎉`;
    const html = this.buildPaymentReceivedHtml({ ...data, amountStr, claimUrl });

    try {
      await this.resend.emails.send({
        from: `Loofta <${this.fromEmail}>`,
        to: data.recipientEmail,
        subject,
        html,
        ...(data.scheduledAt ? { scheduledAt: data.scheduledAt } : {}),
      });
      this.logger.log(`Payment received email scheduled for ${data.recipientEmail} (claim ${data.id}, at ${data.scheduledAt ?? 'now'})`);
    } catch (err: any) {
      this.logger.error(`Failed to send payment received email for claim ${data.id}: ${err?.message ?? err}`);
    }
  }

  async sendClaimReadyEmail(data: ClaimEmailData): Promise<void> {
    if (!this.resend) return;
    const amountStr = `$${parseFloat(String(data.amount)).toFixed(2)}`;
    const claimUrl = data.claimUrl
      ? `https://pay.loofta.xyz${new URL(data.claimUrl, 'https://pay.loofta.xyz').pathname}`
      : `https://pay.loofta.xyz/c/${data.id}`;
    const subject = `You have ${amountStr} waiting for you on Loofta`;
    const html = this.buildClaimReadyHtml({ ...data, amountStr, claimUrl });

    try {
      await this.resend.emails.send({
        from: `Loofta <${this.fromEmail}>`,
        to: data.recipientEmail,
        subject,
        html,
        ...(data.scheduledAt ? { scheduledAt: data.scheduledAt } : {}),
      });
      this.logger.log(`Claim ready email scheduled for ${data.recipientEmail} (claim ${data.id}, at ${data.scheduledAt ?? 'now'})`);
    } catch (err: any) {
      this.logger.error(`Failed to send claim ready email for claim ${data.id}: ${err?.message ?? err}`);
    }
  }

  async sendMainnetLiveEmail(recipientEmail: string): Promise<void> {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: recipientEmail,
        subject: 'we\'re live. 🎉',
        html: this.buildMainnetLiveHtml(),
      });
      this.logger.log(`Mainnet live email sent to ${recipientEmail}`);
    } catch (err: any) {
      this.logger.error(`Failed to send mainnet live email to ${recipientEmail}: ${err?.message ?? err}`);
      throw err;
    }
  }

  async sendMainnetLaunchEmail(recipientEmail: string): Promise<void> {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: recipientEmail,
        subject: 'it\'s finally happening 🎉',
        html: this.buildMainnetLaunchHtml(),
      });
      this.logger.log(`Mainnet launch email sent to ${recipientEmail}`);
    } catch (err: any) {
      this.logger.error(`Failed to send mainnet launch email to ${recipientEmail}: ${err?.message ?? err}`);
      throw err;
    }
  }

  async sendBetaAccessEmail(recipientEmail: string): Promise<void> {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: recipientEmail,
        subject: "you're in 🎉",
        html: this.buildBetaAccessHtml(),
      });
      this.logger.log(`Beta access email sent to ${recipientEmail}`);
    } catch (err: any) {
      this.logger.error(`Failed to send beta access email to ${recipientEmail}: ${err?.message ?? err}`);
    }
  }

  async sendMegapotLaunchEmail(recipientEmail: string): Promise<void> {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: recipientEmail,
        subject: '🎰 Megapot is live — $1,000 in free tickets',
        html: this.buildMegapotLaunchHtml(),
      });
      this.logger.log(`Megapot launch email sent to ${recipientEmail}`);
    } catch (err: any) {
      this.logger.error(`Failed to send Megapot launch email to ${recipientEmail}: ${err?.message ?? err}`);
      throw err;
    }
  }

  async sendMegapotResultsFixEmail(recipientEmail: string): Promise<void> {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: recipientEmail,
        subject: 'go check your Megapot tickets again 👀',
        html: this.buildMegapotResultsFixHtml(),
      });
      this.logger.log(`Megapot results-fix email sent to ${recipientEmail}`);
    } catch (err: any) {
      this.logger.error(`Failed to send Megapot results-fix email to ${recipientEmail}: ${err?.message ?? err}`);
      throw err;
    }
  }

  async sendPaymentsFixedEmail(recipientEmail: string): Promise<void> {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: recipientEmail,
        subject: 'payments are fixed 🔧',
        html: this.buildPaymentsFixedHtml(),
      });
      this.logger.log(`Payments-fixed email sent to ${recipientEmail}`);
    } catch (err: any) {
      this.logger.error(`Failed to send payments-fixed email to ${recipientEmail}: ${err?.message ?? err}`);
      throw err;
    }
  }

  /** Sent when a Mystery Pack's treasury-funded ticket purchase permanently failed and the pack
   *  cost was refunded to the user's wallet instead — invites them to open a fresh pack. */
  async sendPackRefundEmail(data: { recipientEmail: string; costUsdc: number }): Promise<void> {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: data.recipientEmail,
        subject: `Refunded your $${data.costUsdc.toFixed(2)} Mystery Pack`,
        html: this.buildPackRefundHtml(data),
      });
      this.logger.log(`Pack refund email sent to ${data.recipientEmail} ($${data.costUsdc})`);
    } catch (err: any) {
      this.logger.error(`Failed to send pack refund email to ${data.recipientEmail}: ${err?.message ?? err}`);
      throw err;
    }
  }

  async sendGiveawayApprovedEmail(data: { recipientEmail: string; title: string; giveawayUrl: string }): Promise<void> {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: data.recipientEmail,
        subject: `Your giveaway "${data.title}" was approved — fund it to go live`,
        html: this.buildGiveawayApprovedHtml(data),
      });
      this.logger.log(`Giveaway approved email sent to ${data.recipientEmail}`);
    } catch (err: any) {
      this.logger.error(`Failed to send giveaway approved email to ${data.recipientEmail}: ${err?.message ?? err}`);
      throw err;
    }
  }

  /** Sent to a giveaway winner once their claim link is actually ready (payout succeeded, not
   *  just "selected") — never throws, matching sendPaymentReceivedEmail/sendClaimReadyEmail's
   *  fire-and-forget convention, since a failed notification email shouldn't fail the payout
   *  itself. Only ever called for entrants with an email on file (see getEmailByPrivyId). */
  async sendGiveawayWonEmail(data: { recipientEmail: string; title: string; amountUsd: string | number; claimUrl: string }): Promise<void> {
    if (!this.resend) return;
    const amountStr = `$${parseFloat(String(data.amountUsd)).toFixed(2)}`;
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: data.recipientEmail,
        subject: `You won "${data.title}" — ${amountStr} is ready to claim 🎉`,
        html: this.buildGiveawayWonHtml({ ...data, amountStr }),
      });
      this.logger.log(`Giveaway won email sent to ${data.recipientEmail} (${amountStr})`);
    } catch (err: any) {
      this.logger.error(`Failed to send giveaway won email to ${data.recipientEmail}: ${err?.message ?? err}`);
    }
  }

  async sendGiftTicketEmail(data: { recipientEmail: string; numTickets: number; claimUrl: string; note?: string | null }): Promise<void> {
    if (!this.resend) return;
    const ticketWord = data.numTickets === 1 ? 'ticket' : 'tickets';
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: data.recipientEmail,
        subject: `You've been gifted ${data.numTickets} Megapot ${ticketWord} 🎁`,
        html: this.buildGiftTicketHtml(data),
      });
      this.logger.log(`Gift ticket email sent to ${data.recipientEmail} (${data.numTickets} tickets)`);
    } catch (err: any) {
      this.logger.error(`Failed to send gift ticket email to ${data.recipientEmail}: ${err?.message ?? err}`);
      throw err;
    }
  }

  /**
   * Sent to a user whose Megapot purchase briefly showed as "failed" due to a backend bug, even
   * though the purchase actually went through — their ticket is confirmed active now. Recovery
   * comms for the 2026-07-20/21 custom-number-ticket allowance bug and its follow-on issues.
   */
  async sendTicketRecoveredEmail(data: {
    recipientEmail: string;
    numTickets: number;
    roundId: string;
  }): Promise<void> {
    if (!this.resend) return;
    const ticketWord = data.numTickets === 1 ? 'ticket' : 'tickets';
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: data.recipientEmail,
        subject: `Your Megapot ${ticketWord} ${data.numTickets === 1 ? 'is' : 'are'} confirmed active 🎟️`,
        html: this.buildTicketRecoveredHtml(data),
      });
      this.logger.log(`Ticket recovered email sent to ${data.recipientEmail} (${data.numTickets} tickets, round ${data.roundId})`);
    } catch (err: any) {
      this.logger.error(`Failed to send ticket recovered email to ${data.recipientEmail}: ${err?.message ?? err}`);
      throw err;
    }
  }

  /** Sent when a Megapot ticket resolves to status 'won' — invites the recipient to claim their
   *  winnings (which land in their Loofta balance, withdrawable as USDC or cashed out to Naira/
   *  USD/EUR/GBP). Non-throwing/best-effort, matching sendPaymentReceivedEmail — this is meant to
   *  be called in a loop over many winners (per-round broadcast or settlement-time trigger), and
   *  one recipient's bad email shouldn't abort the rest. */
  async sendMegapotWinEmail(data: {
    recipientEmail: string;
    winAmountUsdc: number;
    roundId: string;
    username?: string | null;
    numTickets?: number;
  }): Promise<void> {
    if (!this.resend) return;
    const amountStr = `$${data.winAmountUsdc.toFixed(2)}`;
    const subject = `You won ${amountStr} on Megapot 🎉`;
    const html = this.buildMegapotWinHtml({ ...data, amountStr });
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: data.recipientEmail,
        subject,
        html,
      });
      this.logger.log(`Megapot win email sent to ${data.recipientEmail} (${amountStr}, round ${data.roundId})`);
    } catch (err: any) {
      this.logger.error(`Failed to send Megapot win email to ${data.recipientEmail}: ${err?.message ?? err}`);
    }
  }

  private buildMegapotWinHtml(data: { amountStr: string; roundId: string; username?: string | null; numTickets?: number }): string {
    const dashboardUrl = 'https://pay.loofta.xyz/app/megapot';
    const greeting = data.username ? `Hey @${data.username},` : 'Hey,';
    const ticketLine = data.numTickets && data.numTickets > 1 ? ` (across ${data.numTickets} tickets)` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>You won on Megapot</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto;" />
              <span style="display:inline-block;margin-top:16px;background:#0d3b2e;color:#5EEAD4;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:5px 12px;border-radius:999px;">Won 🎉</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 32px;">
              <p style="margin:0 0 24px;font-size:18px;color:#ffffff;font-weight:500;text-align:center;">Your ticket for round ${data.roundId} hit${ticketLine}</p>
              <div style="background:#0f0f12;border:1px solid #0d3b2e;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
                <p style="margin:0 0 4px;font-size:12px;color:#6b7280;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;">You won</p>
                <p style="margin:0;font-size:40px;font-weight:500;color:#5EEAD4;letter-spacing:-1px;">${data.amountStr}</p>
              </div>
              <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;text-align:center;line-height:1.6;">
                ${greeting} claim it and it lands straight in your Loofta balance. Withdraw as USDC, or cash out directly to your bank.
              </p>
              <div style="text-align:center;margin-bottom:8px;">
                <a href="${dashboardUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Claim your winnings
                </a>
              </div>
              <p style="margin:20px 0 4px;font-size:14px;color:#9ca3af;">Lisa</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  async sendUnclaimedWinningsReminderEmail(data: {
    recipientEmail: string;
    totalWinAmountUsdc: number;
    numTickets: number;
    username?: string | null;
  }): Promise<void> {
    if (!this.resend) return;
    const amountStr = `$${data.totalWinAmountUsdc.toFixed(2)}`;
    const subject = `${amountStr} still waiting for you on Loofta`;
    const html = this.buildUnclaimedWinningsReminderHtml({ ...data, amountStr });
    try {
      await this.resend.emails.send({
        from: 'Lisa from Loofta <hello@loofta.xyz>',
        to: data.recipientEmail,
        subject,
        html,
      });
      this.logger.log(`Unclaimed winnings reminder sent to ${data.recipientEmail} (${amountStr}, ${data.numTickets} ticket(s))`);
    } catch (err: any) {
      this.logger.error(`Failed to send unclaimed winnings reminder to ${data.recipientEmail}: ${err?.message ?? err}`);
    }
  }

  private buildUnclaimedWinningsReminderHtml(data: { amountStr: string; numTickets: number; username?: string | null }): string {
    const dashboardUrl = 'https://pay.loofta.xyz/app/megapot';
    const greeting = data.username ? `Hey @${data.username},` : 'Hey,';
    const ticketLine = data.numTickets > 1 ? `across ${data.numTickets} winning tickets` : 'from a winning ticket';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Megapot winnings are still waiting</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto;" />
              <span style="display:inline-block;margin-top:16px;background:#0d3b2e;color:#5EEAD4;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:5px 12px;border-radius:999px;">Still unclaimed</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 32px;">
              <p style="margin:0 0 24px;font-size:18px;color:#ffffff;font-weight:500;text-align:center;">${greeting} you've got winnings ${ticketLine} sitting unclaimed</p>
              <div style="background:#0f0f12;border:1px solid #0d3b2e;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
                <p style="margin:0 0 4px;font-size:12px;color:#6b7280;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;">Waiting for you</p>
                <p style="margin:0;font-size:40px;font-weight:500;color:#5EEAD4;letter-spacing:-1px;">${data.amountStr}</p>
              </div>
              <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;text-align:center;line-height:1.6;">
                It's already in your Loofta balance. Withdraw it as USDC, or cash out directly to your bank whenever you're ready.
              </p>
              <div style="text-align:center;margin-bottom:8px;">
                <a href="${dashboardUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Withdraw your winnings
                </a>
              </div>
              <p style="margin:20px 0 4px;font-size:14px;color:#9ca3af;">Lisa</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildTicketRecoveredHtml(data: { numTickets: number; roundId: string }): string {
    const ticketWord = data.numTickets === 1 ? 'ticket' : 'tickets';
    const dashboardUrl = 'https://pay.loofta.xyz/app/megapot';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Megapot ticket is confirmed active</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto;" />
              <span style="display:inline-block;margin-top:16px;background:#0d3b2e;color:#5EEAD4;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:5px 12px;border-radius:999px;">Fixed</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 8px;">
              <p style="margin:0 0 12px;font-size:28px;line-height:1.15;color:#ffffff;font-weight:700;text-align:center;">Your ${data.numTickets} Megapot ${ticketWord}<br/>${data.numTickets === 1 ? 'is' : 'are'} confirmed active</p>
              <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;text-align:center;line-height:1.6;">
                We found a bug that showed some purchases as "failed" even though they'd actually gone through on-chain. Yours was one of them, sorry about that. Your ${ticketWord} for round ${data.roundId} ${data.numTickets === 1 ? 'is' : 'are'} in and eligible for the draw, no action needed on your end.
              </p>
              <div style="text-align:center;margin-bottom:8px;">
                <a href="${dashboardUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  View your ticket${data.numTickets === 1 ? '' : 's'}
                </a>
              </div>
              <p style="margin:20px 0 4px;font-size:14px;color:#9ca3af;">Lisa</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Operational alert (to the team, not a user) — the Solana fee wallet that funds Megapot bridge
   * top-ups + gas is running low. Sent when SOL and/or USDC drops under threshold. Plain internal
   * email; deliberately not branded like the user-facing ones.
   */
  async sendFeeWalletLowBalanceEmail(data: {
    to: string;
    walletAddress: string;
    solBalance: number;
    solThreshold: number;
    usdcBalance: number;
    usdcThreshold: number;
    low: Array<'SOL' | 'USDC'>;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`Fee-wallet low-balance alert NOT sent (RESEND_API_KEY unset): SOL=${data.solBalance}, USDC=${data.usdcBalance}`);
      return;
    }
    const solLow = data.low.includes('SOL');
    const usdcLow = data.low.includes('USDC');
    const subject = `⚠️ Loofta fee wallet low: ${data.low.join(' + ')} below threshold`;
    const row = (label: string, val: string, isLow: boolean) =>
      `<tr><td style="padding:6px 12px;color:#475569;">${label}</td><td style="padding:6px 12px;font-weight:600;color:${isLow ? '#dc2626' : '#0f172a'};">${val}${isLow ? ' ⚠️' : ''}</td></tr>`;
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#0f172a;margin:0 0 4px;">Fee wallet running low</h2>
        <p style="color:#64748b;margin:0 0 16px;font-size:14px;">
          The Solana fee wallet funds Megapot bridge top-ups and gas. It no longer collects a per-purchase fee,
          so top it up manually before it runs dry (purchases will stall once it can't cover a bridge top-up).
        </p>
        <table style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:8px;font-size:14px;">
          ${row('Wallet', data.walletAddress, false)}
          ${row('SOL balance', `${data.solBalance.toFixed(4)} SOL (min ${data.solThreshold})`, solLow)}
          ${row('USDC balance', `$${data.usdcBalance.toFixed(2)} (min $${data.usdcThreshold})`, usdcLow)}
        </table>
        <p style="color:#94a3b8;margin:16px 0 0;font-size:12px;">
          Automated alert from the Loofta backend · <a href="https://solscan.io/account/${data.walletAddress}" style="color:#6366f1;">view on Solscan</a>
        </p>
      </div>`;
    try {
      await this.resend.emails.send({
        from: `Loofta Ops <${this.fromEmail}>`,
        to: data.to,
        subject,
        html,
      });
      this.logger.log(`Fee-wallet low-balance alert sent to ${data.to} (low: ${data.low.join(',')})`);
    } catch (err: any) {
      this.logger.error(`Failed to send fee-wallet low-balance alert to ${data.to}: ${err?.message ?? err}`);
    }
  }

  /**
   * Operational alert (to the team, not a user) — fires when `guardAtaSponsorship`
   * (@/common/ata-sponsorship-guard) BLOCKS a repeat sponsored-ATA-creation request. Before this,
   * the guard only logged a warning — real incident, 2026-07-29: the guard was doing its job
   * silently while the fee payer was actively being farmed elsewhere, and nobody found out until
   * a manual wallet-export review days later. This makes a blocked attempt visible the moment it
   * happens instead of requiring someone to go looking for it.
   */
  async sendAtaSponsorshipAbuseAlertEmail(data: {
    to: string;
    walletAddress: string;
    mint: string;
    context: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`ATA-sponsorship abuse alert NOT sent (RESEND_API_KEY unset): wallet=${data.walletAddress}, context=${data.context}`);
      return;
    }
    const subject = `⚠️ Sponsored ATA abuse blocked — ${data.walletAddress.slice(0, 8)}…`;
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#0f172a;margin:0 0 4px;">Sponsored account-creation abuse blocked</h2>
        <p style="color:#64748b;margin:0 0 16px;font-size:14px;">
          This wallet already received a fee-payer-sponsored USDC token account once before and closed it
          (reclaiming the rent to itself) — the create→close→re-sponsor drain pattern. The guard refused to
          pay for it again, so the underlying claim/withdrawal/transfer to this wallet failed rather than
          costing us anything further. No action required unless this keeps recurring for the same wallet.
        </p>
        <table style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:8px;font-size:14px;">
          <tr><td style="padding:6px 12px;color:#475569;">Wallet</td><td style="padding:6px 12px;font-weight:600;color:#dc2626;">${data.walletAddress}</td></tr>
          <tr><td style="padding:6px 12px;color:#475569;">Mint</td><td style="padding:6px 12px;font-weight:600;color:#0f172a;">${data.mint}</td></tr>
          <tr><td style="padding:6px 12px;color:#475569;">Context</td><td style="padding:6px 12px;font-weight:600;color:#0f172a;">${data.context}</td></tr>
        </table>
        <p style="color:#94a3b8;margin:16px 0 0;font-size:12px;">
          Automated alert from the Loofta backend · <a href="https://solscan.io/account/${data.walletAddress}" style="color:#6366f1;">view wallet on Solscan</a>
        </p>
      </div>`;
    try {
      await this.resend.emails.send({
        from: `Loofta Ops <${this.fromEmail}>`,
        to: data.to,
        subject,
        html,
      });
      this.logger.log(`ATA-sponsorship abuse alert sent to ${data.to} (wallet=${data.walletAddress}, context=${data.context})`);
    } catch (err: any) {
      this.logger.error(`Failed to send ATA-sponsorship abuse alert to ${data.to}: ${err?.message ?? err}`);
    }
  }

  /** Fired when a creator submits a new giveaway for review — PENDING_APPROVAL sits invisible
   *  until someone checks the admin dashboard, so this makes a submission show up immediately
   *  instead of relying on remembering to look. Not sent for an official ("create as Loofta")
   *  giveaway, since those auto-approve and skip PENDING_APPROVAL entirely. */
  async sendGiveawaySubmittedAlertEmail(data: {
    to: string;
    title: string;
    creatorEmail: string | null;
    prizeAmountUsd: number;
    winnerCount: number;
    adminUrl: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`Giveaway-submitted alert NOT sent (RESEND_API_KEY unset): title=${data.title}`);
      return;
    }
    const subject = `🎁 New giveaway to review — "${data.title}"`;
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#0f172a;margin:0 0 4px;">New giveaway submitted for approval</h2>
        <p style="color:#64748b;margin:0 0 16px;font-size:14px;">
          A creator just submitted a giveaway — it stays invisible to entrants until you approve it in the admin dashboard.
        </p>
        <table style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:8px;font-size:14px;">
          <tr><td style="padding:6px 12px;color:#475569;">Title</td><td style="padding:6px 12px;font-weight:600;color:#0f172a;">${data.title}</td></tr>
          <tr><td style="padding:6px 12px;color:#475569;">Creator</td><td style="padding:6px 12px;font-weight:600;color:#0f172a;">${data.creatorEmail ?? "no email linked"}</td></tr>
          <tr><td style="padding:6px 12px;color:#475569;">Prize</td><td style="padding:6px 12px;font-weight:600;color:#0f172a;">$${data.prizeAmountUsd} × ${data.winnerCount} winner${data.winnerCount === 1 ? "" : "s"}</td></tr>
        </table>
        <p style="color:#94a3b8;margin:16px 0 0;font-size:12px;">
          Open the admin dashboard's Giveaways tab to approve or reject · <a href="${data.adminUrl}" style="color:#6366f1;">${data.adminUrl}</a>
        </p>
      </div>`;
    try {
      await this.resend.emails.send({
        from: `Loofta Ops <${this.fromEmail}>`,
        to: data.to,
        subject,
        html,
      });
      this.logger.log(`Giveaway-submitted alert sent to ${data.to} (title=${data.title})`);
    } catch (err: any) {
      this.logger.error(`Failed to send giveaway-submitted alert to ${data.to}: ${err?.message ?? err}`);
    }
  }

  /** Distinct from sendAtaSponsorshipAbuseAlertEmail: that one fires on a *repeat* sponsorship of
   *  the SAME wallet, which a Sybil attacker trivially evades by using a fresh throwaway wallet
   *  every time. This one fires when the sponsored-ATA-creation *rate* itself spikes regardless of
   *  which wallets are involved — the signal that actually catches that evasion — and reports that
   *  sponsorship is now paused fleet-wide until manually cleared. */
  async sendAtaSponsorshipBurstAlertEmail(data: {
    to: string;
    count: number;
    windowSeconds: number;
    context: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`ATA-sponsorship BURST alert NOT sent (RESEND_API_KEY unset): ${data.count} in ${data.windowSeconds}s, last context=${data.context}`);
      return;
    }
    const subject = `🚨 Sponsored ATA burst detected — creation paused fleet-wide`;
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#0f172a;margin:0 0 4px;">Sponsored account-creation burst — auto-paused</h2>
        <p style="color:#64748b;margin:0 0 16px;font-size:14px;">
          ${data.count} sponsored USDC token accounts were created in the last ${data.windowSeconds} seconds —
          across possibly many different wallets, so the per-wallet repeat guard alone did not catch it.
          <strong>All sponsored ATA creation is now paused</strong> fleet-wide until this is manually
          cleared, so no further SOL can drain through this path in the meantime.
        </p>
        <table style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:8px;font-size:14px;">
          <tr><td style="padding:6px 12px;color:#475569;">Count</td><td style="padding:6px 12px;font-weight:600;color:#dc2626;">${data.count}</td></tr>
          <tr><td style="padding:6px 12px;color:#475569;">Window</td><td style="padding:6px 12px;font-weight:600;color:#0f172a;">${data.windowSeconds}s</td></tr>
          <tr><td style="padding:6px 12px;color:#475569;">Last context</td><td style="padding:6px 12px;font-weight:600;color:#0f172a;">${data.context}</td></tr>
        </table>
        <p style="color:#94a3b8;margin:16px 0 0;font-size:12px;">
          Check the fee payer's recent transactions on Solscan, confirm this is real abuse (not a legitimate
          traffic spike), then clear the pause via the admin endpoint once safe.
        </p>
      </div>`;
    try {
      await this.resend.emails.send({
        from: `Loofta Ops <${this.fromEmail}>`,
        to: data.to,
        subject,
        html,
      });
      this.logger.log(`ATA-sponsorship BURST alert sent to ${data.to} (count=${data.count}, window=${data.windowSeconds}s)`);
    } catch (err: any) {
      this.logger.error(`Failed to send ATA-sponsorship BURST alert to ${data.to}: ${err?.message ?? err}`);
    }
  }

  private buildGiftTicketHtml(data: { numTickets: number; claimUrl: string; note?: string | null }): string {
    const ticketWord = data.numTickets === 1 ? 'ticket' : 'tickets';
    const { text: noteText, gifUrl } = data.note ? this.extractGifUrl(data.note) : { text: '', gifUrl: null };
    const noteTextBlock = noteText
      ? `<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#9ca3af;">Message</p>
         <p style="margin:0;font-size:14px;line-height:1.5;color:#d1d5db;">${noteText}</p>`
      : '';
    const gifBlock = gifUrl
      ? `<div style="${noteText ? 'margin-top:12px;' : ''}text-align:center;"><img src="${gifUrl}" alt="GIF" style="max-width:100%;border-radius:8px;display:block;margin:0 auto;" /></div>`
      : '';
    const noteBlock = (noteText || gifBlock)
      ? `<div style="background:#1e1e23;border-radius:12px;padding:16px 18px;margin:0 0 28px;">
           ${noteTextBlock}
           ${gifBlock}
         </div>`
      : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>You've been gifted a Megapot ticket</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto;" />
              <span style="display:inline-block;margin-top:16px;background:#0d3b2e;color:#5EEAD4;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:5px 12px;border-radius:999px;">Gift</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 8px;">
              <p style="margin:0 0 12px;font-size:28px;line-height:1.15;color:#ffffff;font-weight:700;text-align:center;">You've been gifted<br/>${data.numTickets} Megapot ${ticketWord}</p>
              <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;text-align:center;">Claim it to enter the next draw — Loofta covers the cost, no wallet needed yet.</p>
              ${noteBlock}
              <div style="text-align:center;margin-bottom:8px;">
                <a href="${data.claimUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Claim your ${ticketWord}
                </a>
              </div>
              <p style="margin:20px 0 4px;font-size:14px;color:#9ca3af;">Lisa</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildMegapotLaunchHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Megapot is live</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto;" />
              <span style="display:inline-block;margin-top:16px;background:#0d3b2e;color:#5EEAD4;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:5px 12px;border-radius:999px;">Live now</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 8px;">
              <p style="margin:0 0 28px;font-size:28px;line-height:1.15;color:#ffffff;font-weight:700;text-align:center;">Play Megapot,<br/>privately.</p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td style="padding:16px 18px;background:#1e1e23;border-radius:12px;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#9ca3af;">Onchain today</p>
                    <p style="margin:0;font-size:14px;line-height:1.5;color:#d1d5db;">Your wallet, amounts, and timing — public to everyone.</p>
                  </td>
                </tr>
                <tr><td style="height:10px;"></td></tr>
                <tr>
                  <td style="padding:16px 18px;background:#0d2b3d;border:1px solid #1a4a63;border-radius:12px;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5EEAD4;">Through Loofta</p>
                    <p style="margin:0;font-size:14px;line-height:1.5;color:#d1d5db;">Same jackpot, same odds — <strong style="color:#ffffff;">your entries stay private.</strong></p>
                  </td>
                </tr>
              </table>

              <div style="background:#0a0a0c;border:1px solid #2a2a30;border-radius:12px;padding:20px 22px;margin:24px 0 28px;">
                <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#5EEAD4;">$1,000 in free tickets</p>
                <p style="margin:0;font-size:14px;color:#9ca3af;">Buy 5+ tickets privately to qualify — the pool is split across everyone who does.</p>
              </div>

              <div style="text-align:center;margin-bottom:8px;">
                <a href="https://pay.loofta.xyz/megapot" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Buy tickets privately
                </a>
              </div>
              <p style="margin:12px 0 24px;font-size:13px;color:#6b7280;text-align:center;">
                Giveaway details: <a href="https://pay.loofta.xyz/rewards/megapot" style="color:#FF4A26;text-decoration:none;">pay.loofta.xyz/rewards/megapot</a>
              </p>
              <p style="margin:0 0 4px;font-size:14px;color:#9ca3af;">Lisa</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildMegapotResultsFixHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Megapot results fix</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 32px;color:#d1d5db;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 16px;">hey, this is Lisa from Loofta.</p>
              <p style="margin:0 0 16px;">We found a bug in how Megapot results were tracked, some tickets showed no win when they'd actually won, real money just sitting unclaimed. Nothing was ever at risk, it was a display issue, not a funds issue, and we've already fixed every case we found.</p>
              <p style="margin:0 0 28px;">Take two minutes and check your ticket history. If anything looks off, just reply and I'll look into it myself.</p>
              <div style="text-align:center;margin-bottom:24px;">
                <a href="https://pay.loofta.xyz/app/megapot" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Check my tickets
                </a>
              </div>
              <p style="margin:0;">Sorry for the trouble, and thanks for playing.</p>
              <p style="margin:16px 0 0;font-size:14px;color:#9ca3af;">Lisa</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildPaymentsFixedHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Payments are fixed</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 20px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto 18px;" />
              <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;">✅ Payments are fixed</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 40px 32px;color:#d1d5db;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 16px;">hey, this is Lisa from Loofta.</p>
              <p style="margin:0 0 16px;">We had a small issue with payments sent to someone who hadn't signed up for Loofta yet, some of those could get stuck mid-transfer instead of going through. Nothing was ever at risk, your funds stayed safely in your wallet the whole time, it just didn't complete.</p>
              <p style="margin:0 0 28px;">It's fixed now, payments are working normally again.</p>
              <div style="text-align:center;margin-bottom:24px;">
                <a href="https://pay.loofta.xyz/app" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Make a payment now
                </a>
              </div>
              <p style="margin:0;">Thanks for bearing with us, and reply here if you run into anything else.</p>
              <p style="margin:16px 0 0;font-size:14px;color:#9ca3af;">Lisa</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildGiveawayApprovedHtml(data: { title: string; giveawayUrl: string }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Giveaway approved</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 20px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto 18px;" />
              <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;">🎉 Your giveaway was approved</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 40px 32px;color:#d1d5db;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 16px;">hey, this is Lisa from Loofta.</p>
              <p style="margin:0 0 16px;">"${data.title}" just got approved — the last step is funding the burner wallet so it can open for entries.</p>
              <p style="margin:0 0 28px;">Once it's funded, it goes live automatically and shows up for entrants to join.</p>
              <div style="text-align:center;margin-bottom:24px;">
                <a href="${data.giveawayUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Fund giveaway
                </a>
              </div>
              <p style="margin:0;">Reply here if you run into anything.</p>
              <p style="margin:16px 0 0;font-size:14px;color:#9ca3af;">Lisa</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildGiveawayWonHtml(data: { title: string; amountStr: string; claimUrl: string }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>You won a giveaway</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 20px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto 18px;" />
              <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;">🎉 You won!</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 40px 32px;color:#d1d5db;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 16px;">Congrats — you won "${data.title}" on Loofta.</p>
              <p style="margin:0 0 28px;">${data.amountStr} is ready to claim, verified and funded before the draw ever ran.</p>
              <div style="text-align:center;margin-bottom:24px;">
                <a href="${data.claimUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Claim ${data.amountStr}
                </a>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildPackRefundHtml(data: { costUsdc: number }): string {
    const amountStr = `$${data.costUsdc.toFixed(2)}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mystery Pack refunded</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 20px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto 18px;" />
              <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;">💸 ${amountStr} refunded</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 40px 32px;color:#d1d5db;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 16px;">hey, this is Lisa from Loofta.</p>
              <p style="margin:0 0 16px;">Your Mystery Pack open hit a bug on our end after you paid — we couldn't complete it, so instead of leaving it stuck we've refunded the full ${amountStr} straight back to your wallet.</p>
              <p style="margin:0 0 28px;">The bug's fixed now, so feel free to open another pack whenever you like.</p>
              <div style="text-align:center;margin-bottom:24px;">
                <a href="https://pay.loofta.xyz/app/megapot/packs" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Open a Mystery Pack
                </a>
              </div>
              <p style="margin:0;">Sorry for the trouble, and reply here if you run into anything else.</p>
              <p style="margin:16px 0 0;font-size:14px;color:#9ca3af;">Lisa</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildMainnetLiveHtml(): string {
    const imageUrl = 'https://pay.loofta.xyz/liveloofta-email.png';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>we're live</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <tr>
            <td style="padding:0;">
              <img src="${imageUrl}" alt="Loofta is on mainnet" width="520" style="display:block;width:100%;max-width:520px;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px 32px;color:#d1d5db;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 16px;">hey!</p>
              <p style="margin:0 0 16px;">This is Lisa from Loofta.</p>
              <p style="margin:0 0 28px;">We're live on mainnet and I'm so happy you're here for this. Here's what you can do right now.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a30;">
                    <p style="margin:0;font-size:13px;color:#6b7280;">Send &amp; receive</p>
                    <p style="margin:2px 0 0;font-size:15px;color:#ffffff;font-weight:500;">Private payments to any email, username, or X handle</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a30;">
                    <p style="margin:0;font-size:13px;color:#6b7280;">Bulk pay</p>
                    <p style="margin:2px 0 0;font-size:15px;color:#ffffff;font-weight:500;">Pay your whole team at once, privately</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a30;">
                    <p style="margin:0;font-size:13px;color:#6b7280;">Payment links</p>
                    <p style="margin:2px 0 0;font-size:15px;color:#ffffff;font-weight:500;">Create a payment link and share it with your client</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #2a2a30;">
                    <p style="margin:0;font-size:13px;color:#6b7280;">Withdraw</p>
                    <p style="margin:2px 0 0;font-size:15px;color:#ffffff;font-weight:500;">Cash out in any token, your way</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;">
                    <p style="margin:0;font-size:13px;color:#6b7280;">Off-ramp</p>
                    <p style="margin:2px 0 0;font-size:15px;color:#ffffff;font-weight:500;">Withdraw privately to Cash App, Wise, Revolut or Venmo at a low fee</p>
                  </td>
                </tr>
              </table>
              <div style="text-align:center;">
                <a href="https://pay.loofta.xyz" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Start at pay.loofta.xyz
                </a>
              </div>
              <p style="margin:28px 0 0;font-size:14px;color:#9ca3af;text-align:left;">Lisa</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildMainnetLaunchHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>mainnet goes live tomorrow</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:'Clash Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto;" />
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px 32px;color:#d1d5db;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 8px;font-size:32px;text-align:center;line-height:1;">🎉</p>
              <p style="margin:0 0 28px;font-size:20px;color:#ffffff;font-weight:600;text-align:center;">mainnet goes live tomorrow</p>
              <p style="margin:0 0 16px;">hey!</p>
              <p style="margin:0 0 16px;">This is Lisa from Loofta, and I'm so happy you're with us for this.</p>
              <p style="margin:0 0 24px;">We're going live on mainnet tomorrow and I couldn't be more excited to share it with you.</p>
              <div style="background:#0f0f12;border:1px solid #2a2a30;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
                <p style="margin:0 0 4px;font-size:12px;color:#6b7280;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;">Going live</p>
                <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">July 1st at 6PM CET</p>
              </div>
              <p style="margin:0 0 32px;">One heads up before you jump in: you'll need to do a quick upgrade of the app first. Just open Loofta and follow the prompt when you see it. It takes a second and it's totally normal.</p>
              <div style="text-align:center;">
                <a href="https://pay.loofta.xyz" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Open Loofta
                </a>
              </div>
              <p style="margin:28px 0 0;font-size:14px;color:#9ca3af;text-align:left;">Lisa</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">pay.loofta.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildBetaAccessHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>You're in!</title>
  <style>
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/O462VY6O6FTQCS72XVMTQHXAM4NN5CY3/TWF57ITZORMJ3MEWLQQIVO6BMXIB6FUR/MJQFMMOTEGNXDVM7HBBDTQHTVB2M7Y6G.woff2') format('woff2'); font-weight:400; font-display:swap; }
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/2SAK53YLUN7RMYJU4MYLSBV6SSSJEJZB/RXS4DPGJRKOUFZMF5X5BVUGNNKJT65XZ/DJS4RYGIUYUXJQOHY5VCZPKSTXUSHTSP.woff2') format('woff2'); font-weight:500; font-display:swap; }
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/MKEEQN57GWBZOSYWCRODNJOOZNPLMAKN/5SPTSZGHEACWWLF34DQ4WAA4OGU6PQIF/KN7DX4F6PXB74R6L2K2Y4NH3CB7FC53Q.woff2') format('woff2'); font-weight:600; font-display:swap; }
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/P6VJ47S3OYMUC7HYSJLTK7PEIK5O2NPQ/TK62VLUWA76PMTK2XWBNDZB7QVXJGYE3/I5W5NEJGYVFUC5I4XOXVET63OE5PSVHJ.woff2') format('woff2'); font-weight:700; font-display:swap; }
  </style>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:'Clash Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto;" />
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px 32px;color:#d1d5db;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 16px;">hey!</p>
              <p style="margin:0 0 16px;">Lisa's here, the founder of Loofta.</p>
              <p style="margin:0 0 16px;">Congrats — you now have access to our beta! 🎉</p>
              <p style="margin:0 0 16px;">A few things to know:</p>
              <ul style="margin:0 0 16px;padding-left:20px;">
                <li style="margin-bottom:8px;">You can switch between mainnet and devnet from your user menu anytime.</li>
                <li style="margin-bottom:8px;">Some features might not be available yet — but you'll be the first to know as we roll them out.</li>
                <li style="margin-bottom:8px;">You can send payments to anyone using their X username, email address, or a Loofta username (starts with <strong style="color:#ffffff;">loo-</strong>).</li>
                <li style="margin-bottom:8px;">Multi send is available too — send to multiple people at once!</li>
              </ul>
              <p style="margin:0 0 32px;">So excited to have you with us. Try it out and tell me what you think — just reply here!</p>
              <div style="text-align:center;">
                <a href="https://pay.loofta.xyz" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Go to Loofta
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">
                <a href="https://pay.loofta.xyz" style="color:#FF4A26;text-decoration:none;">pay.loofta.xyz</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private extractGifUrl(text: string): { text: string; gifUrl: string | null } {
    const GIF_URL_REGEX = /https?:\/\/(?:[^\s/]+\.)?(?:giphy\.com|tenor\.com|gfycat\.com)\/[^\s]*/gi;
    const gifMatch = text.match(GIF_URL_REGEX);
    const gifUrl = gifMatch ? gifMatch[0] : null;
    const textOnly = text.replace(GIF_URL_REGEX, '').replace(/\s+/g, ' ').trim();
    return { text: textOnly, gifUrl };
  }

  private buildDescriptionHtml(description: string): string {
    const { text: textOnly, gifUrl } = this.extractGifUrl(description);

    const textPart = textOnly
      ? `<p style="margin:12px 0 0;padding:12px 16px;background:#1e1e23;border-radius:8px;color:#9ca3af;font-size:14px;font-style:italic;">"${textOnly}"</p>`
      : '';
    const gifPart = gifUrl
      ? `<div style="margin-top:12px;text-align:center;"><img src="${gifUrl}" alt="GIF" style="max-width:100%;border-radius:8px;display:block;margin:0 auto;" /></div>`
      : '';

    return textPart + gifPart;
  }

  private buildPaymentReceivedHtml(data: ClaimEmailData & { amountStr: string; claimUrl: string }): string {
    const fromLine = data.senderInfo
      ? `<p style="margin:0 0 6px;font-size:14px;color:#6b7280;">From <strong style="color:#e5e7eb;font-weight:500;">${data.senderInfo}</strong></p>`
      : '';
    const descLine = data.description
      ? this.buildDescriptionHtml(data.description)
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Payment received</title>
  <style>
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/O462VY6O6FTQCS72XVMTQHXAM4NN5CY3/TWF57ITZORMJ3MEWLQQIVO6BMXIB6FUR/MJQFMMOTEGNXDVM7HBBDTQHTVB2M7Y6G.woff2') format('woff2'); font-weight:400; font-display:swap; }
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/2SAK53YLUN7RMYJU4MYLSBV6SSSJEJZB/RXS4DPGJRKOUFZMF5X5BVUGNNKJT65XZ/DJS4RYGIUYUXJQOHY5VCZPKSTXUSHTSP.woff2') format('woff2'); font-weight:500; font-display:swap; }
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/MKEEQN57GWBZOSYWCRODNJOOZNPLMAKN/5SPTSZGHEACWWLF34DQ4WAA4OGU6PQIF/KN7DX4F6PXB74R6L2K2Y4NH3CB7FC53Q.woff2') format('woff2'); font-weight:600; font-display:swap; }
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/P6VJ47S3OYMUC7HYSJLTK7PEIK5O2NPQ/TK62VLUWA76PMTK2XWBNDZB7QVXJGYE3/I5W5NEJGYVFUC5I4XOXVET63OE5PSVHJ.woff2') format('woff2'); font-weight:700; font-display:swap; }
  </style>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:'Clash Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 32px;">
              <p style="margin:0 0 8px;font-size:32px;text-align:center;line-height:1;">🎉</p>
              <p style="margin:0 0 24px;font-size:18px;color:#ffffff;font-weight:500;text-align:center;">Your payment has arrived</p>
              <div style="background:#0f0f12;border:1px solid #3a1a10;border-radius:12px;padding:24px;text-align:center;margin-bottom:20px;">
                <p style="margin:0 0 4px;font-size:12px;color:#6b7280;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;">Amount received</p>
                <p style="margin:0;font-size:40px;font-weight:500;color:#FF4A26;letter-spacing:-1px;">${data.amountStr}</p>
              </div>
              ${fromLine}
              ${descLine}
              <div style="margin-top:28px;text-align:center;">
                <a href="${data.claimUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  View payment
                </a>
              </div>
              <p style="margin:20px 0 0;font-size:13px;color:#4b5563;text-align:center;">
                Or copy this link:<br>
                <a href="${data.claimUrl}" style="color:#FF4A26;word-break:break-all;">${data.claimUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">
                You're receiving this because someone sent you a payment via Loofta.<br>
                <a href="https://pay.loofta.xyz" style="color:#FF4A26;text-decoration:none;">pay.loofta.xyz</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildClaimReadyHtml(data: ClaimEmailData & { amountStr: string; claimUrl: string }): string {
    const fromLine = data.senderInfo
      ? `<p style="margin:0 0 6px;font-size:14px;color:#6b7280;">From <strong style="color:#e5e7eb;font-weight:500;">${data.senderInfo}</strong></p>`
      : '<p style="margin:0 0 6px;font-size:14px;color:#6b7280;">Someone sent you a payment on Loofta</p>';
    const descLine = data.description
      ? this.buildDescriptionHtml(data.description)
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Payment waiting</title>
  <style>
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/O462VY6O6FTQCS72XVMTQHXAM4NN5CY3/TWF57ITZORMJ3MEWLQQIVO6BMXIB6FUR/MJQFMMOTEGNXDVM7HBBDTQHTVB2M7Y6G.woff2') format('woff2'); font-weight:400; font-display:swap; }
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/2SAK53YLUN7RMYJU4MYLSBV6SSSJEJZB/RXS4DPGJRKOUFZMF5X5BVUGNNKJT65XZ/DJS4RYGIUYUXJQOHY5VCZPKSTXUSHTSP.woff2') format('woff2'); font-weight:500; font-display:swap; }
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/MKEEQN57GWBZOSYWCRODNJOOZNPLMAKN/5SPTSZGHEACWWLF34DQ4WAA4OGU6PQIF/KN7DX4F6PXB74R6L2K2Y4NH3CB7FC53Q.woff2') format('woff2'); font-weight:600; font-display:swap; }
    @font-face { font-family:'Clash Grotesk'; src:url('https://cdn.fontshare.com/wf/P6VJ47S3OYMUC7HYSJLTK7PEIK5O2NPQ/TK62VLUWA76PMTK2XWBNDZB7QVXJGYE3/I5W5NEJGYVFUC5I4XOXVET63OE5PSVHJ.woff2') format('woff2'); font-weight:700; font-display:swap; }
  </style>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:'Clash Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2a2a30;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;margin:0 auto;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 32px;">
              <p style="margin:0 0 8px;font-size:32px;text-align:center;line-height:1;">💸</p>
              <p style="margin:0 0 24px;font-size:18px;color:#ffffff;font-weight:500;text-align:center;">You've got money waiting</p>
              <div style="background:#0f0f12;border:1px solid #3a1a10;border-radius:12px;padding:24px;text-align:center;margin-bottom:20px;">
                <p style="margin:0 0 4px;font-size:12px;color:#6b7280;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;">Ready to claim</p>
                <p style="margin:0;font-size:40px;font-weight:500;color:#FF4A26;letter-spacing:-1px;">${data.amountStr}</p>
              </div>
              ${fromLine}
              ${descLine}
              <div style="margin-top:28px;text-align:center;">
                <a href="${data.claimUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Claim your payment
                </a>
              </div>
              <p style="margin:20px 0 0;font-size:13px;color:#4b5563;text-align:center;">
                Or copy this link:<br>
                <a href="${data.claimUrl}" style="color:#FF4A26;word-break:break-all;">${data.claimUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 24px;border-top:1px solid #2a2a30;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4b5563;">
                You're receiving this because someone sent you a payment via Loofta.<br>
                <a href="https://pay.loofta.xyz" style="color:#FF4A26;text-decoration:none;">pay.loofta.xyz</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
