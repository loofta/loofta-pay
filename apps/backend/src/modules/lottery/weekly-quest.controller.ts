import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { AuthGuard } from '@/common/guards';
import { WeeklyQuestService } from './weekly-quest.service';

class SeenDto {
  @IsString()
  awardId: string;
}

@ApiTags('weekly-quest')
@Controller('weekly-quest')
@UseGuards(AuthGuard)
export class WeeklyQuestController {
  constructor(private readonly quest: WeeklyQuestService) {}

  @Get('me')
  @ApiOperation({ summary: "The caller's progress in this week's quest (volume, target, days until the next quest starts, award status)" })
  async me(@Request() req: any) {
    return this.quest.getMyStatus(req.user.id);
  }

  @Post('seen')
  @ApiOperation({ summary: 'Mark a weekly reward as seen (dismisses the toast)' })
  async seen(@Body() dto: SeenDto, @Request() req: any) {
    await this.quest.markSeen(req.user.id, dto.awardId);
    return { ok: true };
  }
}
