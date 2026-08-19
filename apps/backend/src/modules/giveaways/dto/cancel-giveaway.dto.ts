import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelGiveawayDto {
  @ApiPropertyOptional({ description: 'Shown to the creator in the cancellation email and stored as cancel_reason. Defaults to "Cancelled by admin".' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
