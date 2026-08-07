import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ExpireGiveawayDto {
  @ApiPropertyOptional({ description: 'Shown to the creator in the expiry email and stored as cancel_reason. Defaults to "Approved but never funded".' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
