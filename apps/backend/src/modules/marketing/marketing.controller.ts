import { Body, Controller, Get, Header, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '@/common/guards';
import { MarketingService } from './marketing.service';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Loofta email preferences</title>
</head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:480px;background:#17171a;border-radius:16px;overflow:hidden;border:1px solid #2a2a30;">
          <tr>
            <td style="padding:40px;text-align:center;">
              ${bodyHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function messagePage(message: string): string {
  return page(`<p style="margin:0;font-size:16px;color:#d1d5db;line-height:1.6;">${message}</p>`);
}

function confirmPage(email: string, source?: string): string {
  return page(`
    <p style="margin:0 0 24px;font-size:16px;color:#d1d5db;line-height:1.6;">Unsubscribe <strong style="color:#ffffff;">${escapeHtml(email)}</strong> from Loofta marketing emails?</p>
    <form method="POST" action="/marketing/unsubscribe">
      <input type="hidden" name="email" value="${escapeHtml(email)}" />
      ${source ? `<input type="hidden" name="source" value="${escapeHtml(source)}" />` : ''}
      <button type="submit" style="display:inline-block;background:linear-gradient(135deg,#FF4A26,#FF8C00);color:#ffffff;border:none;cursor:pointer;font-weight:500;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.01em;">
        Unsubscribe me
      </button>
    </form>
  `);
}

const BROKEN_LINK_MESSAGE = "That unsubscribe link looks broken — email support@loofta.xyz and we'll take care of it.";

@ApiTags('marketing')
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('unsubscribe')
  @Public()
  @Header('Content-Type', 'text/html')
  @ApiOperation({ summary: 'Show an unsubscribe confirmation page (public, no auth). Does not unsubscribe on its own — GET must never have side effects, since email clients/security scanners auto-visit links.' })
  async showConfirm(@Query('email') email?: string, @Query('source') source?: string): Promise<string> {
    if (!email || !email.includes('@')) {
      return messagePage(BROKEN_LINK_MESSAGE);
    }
    return confirmPage(email, source);
  }

  @Post('unsubscribe')
  @Public()
  @Header('Content-Type', 'text/html')
  @ApiOperation({ summary: 'Actually unsubscribe an email address, after explicit confirmation (public, no auth)' })
  async confirmUnsubscribe(@Body('email') email?: string, @Body('source') source?: string): Promise<string> {
    if (!email || !email.includes('@')) {
      return messagePage(BROKEN_LINK_MESSAGE);
    }
    await this.marketing.unsubscribe(email, source);
    return messagePage(`You're unsubscribed. ${escapeHtml(email)} won't receive Loofta marketing emails anymore.`);
  }
}
