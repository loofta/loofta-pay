import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { Public } from '@/common/guards';
import { GET as chart } from './handlers/chart';
import { GET as holders } from './handlers/holders';
import { GET as info } from './handlers/info';
import { GET as live } from './handlers/live';
import { GET as majors } from './handlers/majors';
import { GET as prestocks } from './handlers/prestocks';
import { GET as pump } from './handlers/pump';
import { GET as search } from './handlers/search';
import { GET as stocks } from './handlers/stocks';
import { GET as trades } from './handlers/trades';

type Handler = (req: Request) => Promise<Response>;

/**
 * Live market data for the Telegram mini app: the Pump feed, live numbers, charts, trades, holders,
 * stocks, pre-IPO tokens and majors. Everything here is public market data served from shared
 * in-memory caches, so one upstream call serves every user. That is also why the per-IP rate limit
 * is off: the mini app reaches this through Vercel, so every user would otherwise share one IP.
 *
 * The handlers are the same code that used to run as Next route handlers. They live here because
 * Vercel is serverless and cannot keep the PumpPortal connection or the provider request queue.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('mini')
export class MiniAppController {
  /** Runs a handler written against the platform Request and Response, and sends its answer through Express. */
  private async run(handler: Handler, req: ExpressRequest, res: ExpressResponse): Promise<void> {
    const url = new URL(req.originalUrl, 'http://localhost');
    const out = await handler(new Request(url.toString()));
    res.status(out.status);
    out.headers.forEach((value, key) => res.setHeader(key, value));
    res.send(Buffer.from(await out.arrayBuffer()));
  }

  @Public() @Get('pump') pump(@Req() req: ExpressRequest, @Res() res: ExpressResponse) { return this.run(pump, req, res); }
  @Public() @Get('live') live(@Req() req: ExpressRequest, @Res() res: ExpressResponse) { return this.run(live, req, res); }
  @Public() @Get('chart') chart(@Req() req: ExpressRequest, @Res() res: ExpressResponse) { return this.run(chart, req, res); }
  @Public() @Get('trades') trades(@Req() req: ExpressRequest, @Res() res: ExpressResponse) { return this.run(trades, req, res); }
  @Public() @Get('holders') holders(@Req() req: ExpressRequest, @Res() res: ExpressResponse) { return this.run(holders, req, res); }
  @Public() @Get('info') info(@Req() req: ExpressRequest, @Res() res: ExpressResponse) { return this.run(info, req, res); }
  @Public() @Get('tokens/search') search(@Req() req: ExpressRequest, @Res() res: ExpressResponse) { return this.run(search, req, res); }
  @Public() @Get('tokens/stocks') stocks(@Req() req: ExpressRequest, @Res() res: ExpressResponse) { return this.run(stocks as Handler, req, res); }
  @Public() @Get('tokens/prestocks') prestocks(@Req() req: ExpressRequest, @Res() res: ExpressResponse) { return this.run(prestocks as Handler, req, res); }
  @Public() @Get('tokens/majors') majors(@Req() req: ExpressRequest, @Res() res: ExpressResponse) { return this.run(majors as Handler, req, res); }
}
