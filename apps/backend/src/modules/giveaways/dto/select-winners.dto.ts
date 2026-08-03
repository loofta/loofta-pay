import { ArrayMinSize, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SelectWinnersDto {
  @ApiProperty({ type: [String], description: 'giveaway_entries.id values to select as winners (manual selection mode only)' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  entry_ids: string[];
}
