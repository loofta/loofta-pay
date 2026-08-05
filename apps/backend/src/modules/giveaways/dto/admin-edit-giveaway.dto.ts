import { IsInt, IsISO8601, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
}
