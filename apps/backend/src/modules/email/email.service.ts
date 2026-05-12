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

  private buildDescriptionHtml(description: string): string {
    const GIF_URL_REGEX = /https?:\/\/(?:[^\s/]+\.)?(?:giphy\.com|tenor\.com|gfycat\.com)\/[^\s]*/gi;
    const gifMatch = description.match(GIF_URL_REGEX);
    const gifUrl = gifMatch ? gifMatch[0] : null;
    const textOnly = description.replace(GIF_URL_REGEX, '').replace(/\s+/g, ' ').trim();

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
