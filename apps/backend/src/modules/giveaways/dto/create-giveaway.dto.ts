import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  IsEnum,
  IsUrl,
  IsISO8601,
  MaxLength,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GiveawaySelectionMode, GiveawayTaskType } from '../entities/giveaway.entity';

const MAX_TASKS_PER_GIVEAWAY = 8;

export class GiveawayTaskConfigDto {
  /** Target X handle (x_follow), tweet URL (x_retweet/x_like/x_comment), channel handle (telegram_join),
   *  invite URL (discord_join), or external URL (waitlist_join/create_account). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  target?: string;

  @ApiPropertyOptional({ description: 'Free-text instructions shown to the participant, e.g. what a comment must mention.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment_requirement?: string;

  @ApiPropertyOptional({ description: 'Free-text instructions for visit_link tasks, e.g. "Join waitlist" or "Create an account".' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;

  @ApiPropertyOptional({ description: 'Self-report tasks only — require the entrant to submit a link/screenshot as proof before the task counts as done.' })
  @IsOptional()
  @IsBoolean()
  require_proof?: boolean;
}

export class CreateGiveawayTaskDto {
  @ApiProperty({ enum: GiveawayTaskType })
  @IsEnum(GiveawayTaskType)
  task_type: GiveawayTaskType;

  @ApiProperty({ type: GiveawayTaskConfigDto })
  @ValidateNested()
  @Type(() => GiveawayTaskConfigDto)
  config: GiveawayTaskConfigDto;
}

export class GiveawayEligibilityDto {
  @ApiPropertyOptional({ description: 'Minimum X follower count required to enter.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_followers?: number;

  @ApiPropertyOptional({ description: 'Minimum age (days) of the entrant\'s X account, to raise the bar against throwaway bot accounts.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_account_age_days?: number;
}

export class CreateGiveawayDto {
  @ApiProperty({ example: 'Launch Week Giveaway' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

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


  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(1)
  winner_count: number;

  @ApiProperty({ enum: GiveawaySelectionMode })
  @IsEnum(GiveawaySelectionMode)
  selection_mode: GiveawaySelectionMode;

  @ApiProperty({ description: 'Prize per winner, in USD.', example: 50 })
  @IsNumber()
  @Min(0.01)
  prize_amount_usd: number;

  @ApiProperty({ description: 'ISO 8601 timestamp entries close at.' })
  @IsISO8601()
  entries_close_at: string;

  @ApiProperty({ type: [CreateGiveawayTaskDto], minItems: 1, maxItems: MAX_TASKS_PER_GIVEAWAY })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TASKS_PER_GIVEAWAY)
  @Type(() => CreateGiveawayTaskDto)
  tasks: CreateGiveawayTaskDto[];

  @ApiPropertyOptional({ type: GiveawayEligibilityDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GiveawayEligibilityDto)
  eligibility?: GiveawayEligibilityDto;
}
