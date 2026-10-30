import { Module } from '@nestjs/common';
import { QrPayController } from './qr-pay.controller';

@Module({
  controllers: [QrPayController],
})
export class QrPayModule {}
