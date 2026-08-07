import { IsObject, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitTaskCompletionDto {
  @ApiPropertyOptional({ description: 'Self-report proof — link, text, screenshot url. Ignored for auto_api tasks (X follow/retweet/like/comment), which are verified server-side.' })
  @IsOptional()
  @IsObject()
  submission_data?: Record<string, unknown>;
}
