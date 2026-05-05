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

  // Server-side only — stripped from request body by ValidationPipe whitelist.
  userId?: string;
}
