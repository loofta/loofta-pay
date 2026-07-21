import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, IsBoolean, MaxLength } from 'class-validator';

export class CreateClaimFromUsernameDto {
  @ApiProperty({ description: 'Username (with or without @ prefix)', example: 'looftaxyz' })
  @IsString()
  @IsNotEmpty()
  username: string;

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

  @ApiPropertyOptional({
    description:
      'Set when this "username" is actually a Twitter handle the sender picked from the social ' +
      'platform picker (registered-user lookup still checks the username table, since a Twitter ' +
      'handle can double as a Loofta username) — tags an unresolved handle as a pending Twitter ' +
      'recipient instead of a pending Loofta username, so "edit recipient" later shows the correct platform.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  treatUnregisteredAsTwitter?: boolean;

  // Server-side only — stripped from request body by ValidationPipe whitelist.
  userId?: string;
}
