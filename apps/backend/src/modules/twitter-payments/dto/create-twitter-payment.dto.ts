import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max, MaxLength, Matches } from 'class-validator';

const TWITTER_HANDLE_REGEX = /^[a-zA-Z0-9_]{1,50}$/;

export class CreateTwitterPaymentDto {
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

  // Raised from 0.5 — private payments enforce a $5 minimum in claims.service.ts's
  // buildPrivateTransferForPayer, and the bot's own parser already enforces MIN_AMOUNT_USD = 5;
  // this closes the same gap at the DTO so the private/regular toggle is safe to offer
  // unconditionally rather than needing per-amount gating on the funding page.
  @ApiProperty({ description: 'Amount in USD', example: 5 })
  @IsNumber()
  @Min(5)
  @Max(10000)
  amount_usd: number;

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
