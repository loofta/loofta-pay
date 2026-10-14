import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PRIVACY_TRANSFER_MAX_DELAY_MS } from '../../../common/privacy-transfer-limit';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max, IsInt, IsBoolean, MaxLength, IsIn } from 'class-validator';

export class CreateClaimFromSocialDto {
  @ApiProperty({ description: 'Social platform', enum: ['discord', 'github', 'telegram'] })
  @IsString()
  @IsIn(['discord', 'github', 'telegram'])
  platform: 'discord' | 'github' | 'telegram';

  @ApiProperty({ description: 'Handle on that platform (with or without @ prefix)', example: 'octocat' })
  @IsString()
  @IsNotEmpty()
  handle: string;

  @ApiProperty({ description: 'Amount in USD', example: 100 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Whether this is a private payment', default: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiPropertyOptional({ description: 'Payment description/message (supports emojis and GIFs)', example: '🍕 Pizza party! 🎉' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Solana cluster for this payment', enum: ['devnet', 'mainnet'] })
  @IsOptional()
  @IsString()
  cluster?: 'devnet' | 'mainnet';

  @ApiPropertyOptional({ description: 'MagicBlock private-transfer split (1-15), chosen on the Send form — persisted so later views (recipient, or the sender revisiting without the URL param) know the real value instead of guessing.', minimum: 1, maximum: 15 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  split?: number;

  @ApiPropertyOptional({ description: "MagicBlock private-transfer max delivery delay in ms. The privacy API allows up to 31 days. Chosen on the Send form and persisted so later views quote that same wait.", minimum: 0, maximum: PRIVACY_TRANSFER_MAX_DELAY_MS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRIVACY_TRANSFER_MAX_DELAY_MS)
  maxDelayMs?: number;

  // Server-side only — stripped from request body by ValidationPipe whitelist.
  userId?: string;
  /** ISO timestamp — claim auto-expires (EXPIRED) if still unsettled past this. Server-side only. */
  expiresAt?: string;
}
