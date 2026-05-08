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
    const amountStr = `$${parseFloat(String(data.amount)).toFixed(2)} USDC`;
    const claimUrl = data.claimUrl ?? `https://pay.loofta.xyz/c/${data.id}`;
    const subject = `You received ${amountStr} on Loofta`;
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
    const amountStr = `$${parseFloat(String(data.amount)).toFixed(2)} USDC`;
    const claimUrl = data.claimUrl ?? `https://pay.loofta.xyz/c/${data.id}`;
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

  private buildBetaAccessHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>You're in!</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#FF4A26,#FF8C00);padding:32px 40px 28px;text-align:center;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;color:#374151;font-size:15px;line-height:1.7;">
              <p style="margin:0 0 16px;">hey!</p>
              <p style="margin:0 0 16px;">Lisa's here, the founder of Loofta.</p>
              <p style="margin:0 0 16px;">Congrats — you now have access to our beta! 🎉</p>
              <p style="margin:0 0 16px;">A few things to know:</p>
              <ul style="margin:0 0 16px;padding-left:20px;">
                <li style="margin-bottom:8px;">You can switch between mainnet and devnet from your user menu anytime.</li>
                <li style="margin-bottom:8px;">Some features might not be available yet — but you'll be the first to know as we roll them out.</li>
                <li style="margin-bottom:8px;">You can send payments to anyone using their X username, email address, or a Loofta username (starts with <strong>loo-</strong>).</li>
                <li style="margin-bottom:8px;">Multi send is available too — send to multiple people at once!</li>
              </ul>
              <p style="margin:0 0 32px;">So excited to have you with us. Try it out and tell me what you think — just reply here!</p>
              <div style="text-align:center;">
                <a href="https://pay.loofta.xyz" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Go to Loofta
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid #F3F4F6;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">
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

  private buildPaymentReceivedHtml(data: ClaimEmailData & { amountStr: string; claimUrl: string }): string {
    const fromLine = data.senderInfo
      ? `<p style="margin:0 0 8px;color:#6B7280;font-size:15px;">From <strong style="color:#111827;">${data.senderInfo}</strong></p>`
      : '';
    const descLine = data.description
      ? `<p style="margin:16px 0 0;padding:14px 18px;background:#F9FAFB;border-radius:8px;color:#374151;font-size:14px;font-style:italic;">"${data.description}"</p>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Payment received</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#FF4A26,#FF8C00);padding:32px 40px 28px;text-align:center;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 24px;font-size:17px;color:#374151;font-weight:500;">Your payment has arrived 🎉</p>
              <div style="background:#FFF7F5;border:2px solid #FF4A26;border-radius:12px;padding:24px;text-align:center;margin-bottom:20px;">
                <p style="margin:0 0 4px;font-size:13px;color:#FF4A26;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Amount received</p>
                <p style="margin:0;font-size:40px;font-weight:800;color:#FF4A26;letter-spacing:-1px;">${data.amountStr}</p>
              </div>
              ${fromLine}
              ${descLine}
              <div style="margin-top:32px;text-align:center;">
                <a href="${data.claimUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  View payment
                </a>
              </div>
              <p style="margin:24px 0 0;font-size:13px;color:#9CA3AF;text-align:center;">
                Or copy this link:<br>
                <a href="${data.claimUrl}" style="color:#FF4A26;word-break:break-all;">${data.claimUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid #F3F4F6;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">
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
      ? `<p style="margin:0 0 8px;color:#6B7280;font-size:15px;">From <strong style="color:#111827;">${data.senderInfo}</strong></p>`
      : '<p style="margin:0 0 8px;color:#6B7280;font-size:15px;">Someone sent you a payment on Loofta</p>';
    const descLine = data.description
      ? `<p style="margin:16px 0 0;padding:14px 18px;background:#F9FAFB;border-radius:8px;color:#374151;font-size:14px;font-style:italic;">"${data.description}"</p>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Payment waiting</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#FF4A26,#FF8C00);padding:32px 40px 28px;text-align:center;">
              <img src="https://pay.loofta.xyz/loofta_white_email.png" alt="Loofta" width="134" height="38" style="display:block;border:0;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 24px;font-size:17px;color:#374151;font-weight:500;">You've got money waiting 💸</p>
              <div style="background:#FFF7F5;border:2px solid #FF4A26;border-radius:12px;padding:24px;text-align:center;margin-bottom:20px;">
                <p style="margin:0 0 4px;font-size:13px;color:#FF4A26;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Ready to claim</p>
                <p style="margin:0;font-size:40px;font-weight:800;color:#FF4A26;letter-spacing:-1px;">${data.amountStr}</p>
              </div>
              ${fromLine}
              ${descLine}
              <div style="margin-top:32px;text-align:center;">
                <a href="${data.claimUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
                  Claim your payment
                </a>
              </div>
              <p style="margin:24px 0 0;font-size:13px;color:#9CA3AF;text-align:center;">
                Or copy this link:<br>
                <a href="${data.claimUrl}" style="color:#FF4A26;word-break:break-all;">${data.claimUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid #F3F4F6;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">
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
