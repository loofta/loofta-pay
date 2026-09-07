import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, IsBoolean, MaxLength, IsIn } from 'class-validator';

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

  // Server-side only — stripped from request body by ValidationPipe whitelist.
  userId?: string;
  /** ISO timestamp — claim auto-expires (EXPIRED) if still unsettled past this. Server-side only. */
  expiresAt?: string;
}
