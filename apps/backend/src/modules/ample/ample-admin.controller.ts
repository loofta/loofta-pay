import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '@/common/guards';
import { AmpleService } from './ample.service';

@ApiTags('admin/ample')
@Controller('admin/ample')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class AmpleAdminController {
  constructor(private readonly ample: AmpleService) {}

  @Get('stakers')
  @ApiOperation({ summary: 'Admin: who staked from Loofta and how much' })
  stakers() {
    return this.ample.adminStakers();
  }
}
