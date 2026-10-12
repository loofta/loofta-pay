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
import { GiveawayRewardType, GiveawaySelectionMode, GiveawayTaskType } from '../entities/giveaway.entity';

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

  @ApiPropertyOptional({ description: 'x_post tasks only — the exact text the entrant must post as a brand-new tweet (not a reply/retweet). Also used to generate a pre-filled x.com/intent/tweet link.' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  required_text?: string;

  @ApiPropertyOptional({ description: 'Free-text instructions for visit_link tasks, e.g. "Join waitlist" or "Create an account".' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;

  @ApiPropertyOptional({ description: 'Self-report tasks only — require the entrant to submit a link/screenshot as proof before the task counts as done.' })
  @IsOptional()
  @IsBoolean()
  require_proof?: boolean;

  @ApiPropertyOptional({ description: 'custom tasks only — short title shown to the entrant, e.g. "Join the stream". `target` (optional) is the accompanying link.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
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

  @ApiPropertyOptional({ description: "Require the entrant's X account to carry X's own verified badge." })
  @IsOptional()
  @IsBoolean()
  verified_only?: boolean;

  @ApiPropertyOptional({ type: [String], description: "Only these countries (Sorsa's /about country names, e.g. \"United States\") may enter. OR'd with required_continents — either match qualifies." })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  required_countries?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Only these continents may enter, e.g. ["Africa"] allows any African country. ORed with required_countries.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(6)
  required_continents?: string[];

  @ApiPropertyOptional({ type: [String], description: "Entrants from these countries (Sorsa's /about country names) can't enter, even if required_countries/required_continents would otherwise qualify them." })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  excluded_countries?: string[];
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

  @ApiPropertyOptional({ description: 'Project/brand name shown next to the logo on the giveaway page.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  project_name?: string;


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

  @ApiPropertyOptional({ enum: GiveawayRewardType, description: 'How the prize is delivered — a normal USDC claim link (default), or that many dollars\' worth of gifted Megapot tickets (prize_amount_usd must then be a whole dollar amount, 1-100).' })
  @IsOptional()
  @IsEnum(GiveawayRewardType)
  reward_type?: GiveawayRewardType;

  @ApiPropertyOptional({ description: 'SPL mint winners are paid in. Omit for a USDC prize. The creator still funds USDC; the prize pool is swapped into this mint when funding lands.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  prize_mint?: string | null;

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

  /** "Create as Loofta" — only honored server-side if the caller is actually an admin
   *  (GiveawaysService.create() re-checks; a non-admin sending this is silently ignored). */
  @ApiPropertyOptional({ description: 'Admin-only: create as an official Loofta giveaway (auto-approved, shown with the Loofta brand, pinned to the top of listings). Ignored for non-admins.' })
  @IsOptional()
  @IsBoolean()
  is_official?: boolean;
}
