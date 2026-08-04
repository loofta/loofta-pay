import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '@/common/guards';
import { MarketingService } from './marketing.service';

function confirmationPage(message: string): string {
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
              <p style="margin:0;font-size:16px;color:#d1d5db;line-height:1.6;">${message}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

@ApiTags('marketing')
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('unsubscribe')
  @Public()
  @Header('Content-Type', 'text/html')
  @ApiOperation({ summary: 'Unsubscribe an email address from Loofta marketing emails (public, no auth)' })
  async unsubscribe(@Query('email') email?: string, @Query('source') source?: string): Promise<string> {
    if (!email || !email.includes('@')) {
      return confirmationPage("That unsubscribe link looks broken — email support@loofta.xyz and we'll take care of it.");
    }
    await this.marketing.unsubscribe(email, source);
    return confirmationPage(`You're unsubscribed. ${email} won't receive Loofta marketing emails anymore.`);
  }
}
