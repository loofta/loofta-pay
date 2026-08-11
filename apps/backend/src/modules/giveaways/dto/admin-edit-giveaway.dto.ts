import { IsArray, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUrl, Min, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateGiveawayTaskDto } from './create-giveaway.dto';

/**
 * Updates one existing task's `config` (target/instructions/comment_requirement) by id — never
 * inserts or deletes task rows, since giveaway_task_completions FK-cascades off giveaway_tasks.id
 * and entrants may already have completions recorded against these exact rows. task_type and
 * verification_mode are fixed; only the free-text/target content is editable here.
 */
export class AdminEditGiveawayTaskDto {
  @ApiPropertyOptional()
  @IsString()
  id: string;

  @ApiPropertyOptional()
  @IsObject()
  config: Record<string, unknown>;
}

/**
 * Admin-only, support-mediated edit — deliberately excludes prize_amount_usd/winner_count/
 * selection_mode. Those feed funding_required_usd and the draw itself; changing them once a
 * burner may already hold funds needs a recompute + refund/top-up story this endpoint doesn't
 * have, not just a field update. Everything here is safe to change with no money-math fallout.
 */
export class AdminEditGiveawayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  logo_url?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp entries close at.' })
  @IsOptional()
  @IsISO8601()
  entries_close_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  min_followers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  min_account_age_days?: number;

  @ApiPropertyOptional({ type: [AdminEditGiveawayTaskDto], description: 'Per-task config updates by task id — target/instructions/comment_requirement only.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminEditGiveawayTaskDto)
  tasks?: AdminEditGiveawayTaskDto[];

  @ApiPropertyOptional({
    description:
      'Task ids to delete outright. giveaway_task_completions FK-cascades off giveaway_tasks.id, so this also removes any completion (including an already-verified one) any entrant recorded against that task — intentional, since the task itself no longer exists.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  delete_task_ids?: string[];

  @ApiPropertyOptional({ type: [CreateGiveawayTaskDto], description: 'New tasks to add. Every existing entrant gets a fresh pending completion stub for each one.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGiveawayTaskDto)
  new_tasks?: CreateGiveawayTaskDto[];
}
