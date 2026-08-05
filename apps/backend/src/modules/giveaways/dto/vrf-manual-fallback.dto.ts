import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VrfManualFallbackDto {
  @ApiProperty({ description: 'Why the on-chain VRF request is being bypassed — required, logged to giveaway_events for audit.' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;
}
