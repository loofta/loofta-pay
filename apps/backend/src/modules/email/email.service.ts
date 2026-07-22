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
