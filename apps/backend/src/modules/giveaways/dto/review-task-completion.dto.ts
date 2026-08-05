import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReviewTaskCompletionDto {
  @ApiProperty({ enum: ['verified', 'rejected'] })
  @IsIn(['verified', 'rejected'])
  decision: 'verified' | 'rejected';
}
