import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/guards';
import { FomoService, FomoResolution } from './fomo.service';

@ApiTags('fomo')
@Controller('fomo')
export class FomoController {
  constructor(private readonly fomoService: FomoService) {}

  @Public()
  @Get('resolve/:handle')
  @ApiOperation({ summary: 'Resolve a fomo.family username to its verified Solana wallet' })
  async resolve(@Param('handle') handle: string): Promise<FomoResolution> {
    return this.fomoService.resolve(handle);
  }
}
