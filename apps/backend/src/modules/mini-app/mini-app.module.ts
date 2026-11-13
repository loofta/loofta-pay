import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { MiniAppController } from './mini-app.controller';
import { MiniPayController } from './mini-pay.controller';
import { MiniPayService } from './mini-pay.service';
import { GET as majors } from './handlers/majors';
import { GET as pump } from './handlers/pump';
import { GET as stocks } from './handlers/stocks';

/**
 * Warms the mini app's caches at boot. The PumpPortal stream starts collecting new launches as soon as
 * the server is up, instead of waiting for the first visitor, and the first people to open the app after
 * a deploy do not see empty lists while stocks and majors are built.
 */
@Injectable()
class MiniAppWarmup implements OnApplicationBootstrap {
  private readonly logger = new Logger('MiniApp');

  onApplicationBootstrap() {
    // Not awaited: the server is already accepting requests, this only fills caches.
    setTimeout(() => {
      void Promise.allSettled([pump(new Request('http://localhost/mini/pump')), stocks(), majors()]).then((r) => {
        const ok = r.filter((x) => x.status === 'fulfilled').length;
        this.logger.log(`Warm-up done (${ok}/3). Live stream and caches are filling.`);
      });
    }, 3_000);
  }
}

@Module({
  imports: [DatabaseModule],
  controllers: [MiniAppController, MiniPayController],
  providers: [MiniAppWarmup, MiniPayService],
})
export class MiniAppModule {}
