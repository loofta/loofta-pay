import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { MemecoinTerminalController } from './memecoin-terminal.controller';
import { MemecoinTerminalService } from './memecoin-terminal.service';
import { PumpIngestService } from './pump-ingest.service';
import { MemecoinEnrichService } from './memecoin-enrich.service';
import { GeckoIngestService } from './gecko-ingest.service';
import { GraduatedSeedService } from './graduated-seed.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MemecoinTerminalController],
  providers: [MemecoinTerminalService, PumpIngestService, GeckoIngestService, MemecoinEnrichService, GraduatedSeedService],
  exports: [MemecoinTerminalService],
})
export class MemecoinTerminalModule {}
