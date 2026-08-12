import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsInt, IsOptional, Min, Max, MaxLength, Matches } from 'class-validator';

const TWITTER_HANDLE_REGEX = /^[a-zA-Z0-9_]{1,50}$/;

export class CreateTwitterTicketGiftDto {
  @ApiProperty({ description: 'Sender Twitter handle (no @)', example: 'senderA' })
  @IsString()
  @IsNotEmpty()
  @Matches(TWITTER_HANDLE_REGEX)
  sender_twitter: string;

  @ApiProperty({ description: 'Recipient Twitter handle (no @)', example: 'alice' })
  @IsString()
  @IsNotEmpty()
  @Matches(TWITTER_HANDLE_REGEX)
  recipient_twitter: string;

  @ApiProperty({ description: 'Number of Megapot tickets to gift', example: 3 })
  @IsInt()
  @Min(1)
  @Max(100)
  num_tickets: number;

  @ApiPropertyOptional({ description: 'Source tweet ID for deduplication' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tweet_id?: string;

  @ApiPropertyOptional({ description: 'Full URL of the source tweet' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  tweet_url?: string;

  @ApiPropertyOptional({ description: 'Run on devnet' })
  @IsOptional()
  is_devnet?: boolean;
}
