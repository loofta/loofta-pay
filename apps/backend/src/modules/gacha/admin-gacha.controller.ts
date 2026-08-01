import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { AdminGuard } from '@/common/guards';
import { GachaService } from './gacha.service';

class SetConfigEnabledDto {
  @IsBoolean()
  enabled: boolean;
}

@ApiTags('admin/gacha')
@ApiSecurity('privy-auth')
@Controller('admin/gacha')
@UseGuards(AdminGuard)
export class AdminGachaController {
  constructor(private readonly gacha: GachaService) {}

  @Get('configs')
  @ApiOperation({ summary: 'All room presets, including disabled ones' })
  async configs() {
    return this.gacha.getAdminConfigs();
  }

  @Patch('configs/:configKey')
  @ApiOperation({ summary: 'Enable/disable a room preset' })
  async setConfigEnabled(@Param('configKey') configKey: string, @Body() dto: SetConfigEnabledDto) {
    await this.gacha.setConfigEnabled(configKey, dto.enabled);
    return { ok: true };
  }

  @Get('rooms')
  @ApiOperation({ summary: 'Every room, newest first, for support/ops' })
  async rooms(@Query('page') page?: string) {
    return this.gacha.getAdminRooms(page ? parseInt(page, 10) : 1, 50);
  }
}
