import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, IsBoolean, IsEmail, MaxLength } from 'class-validator';

export class CreateClaimFromEmailDto {
  @ApiProperty({ description: 'Recipient email (they claim by signing in with this email)', example: 'alice@example.com' })
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Amount in USD', example: 100 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Whether this is a private payment', default: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiPropertyOptional({ description: 'Payment description/message' })
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
