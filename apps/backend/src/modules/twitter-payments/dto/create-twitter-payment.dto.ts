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

  // One-cent floor — both the auto-pay execution path and the manual fallback default to
  // regular/public (isPrivate: false), so the private-payment $1 minimum in claims.service.ts's
  // buildPrivateTransferForPayer doesn't apply by default. It still applies if a sender
  // specifically opts into private on the manual funding page below $1 — that throws there,
  // not silently, since that's a real constraint of the private-transfer mechanism itself.
  @ApiProperty({ description: 'Amount in USD', example: 5 })
  @IsNumber()
  @Min(0.01)
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
