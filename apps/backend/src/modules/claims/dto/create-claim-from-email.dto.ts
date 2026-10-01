import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max, IsInt, IsBoolean, IsEmail, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'MagicBlock private-transfer split (1-15), chosen on the Send form — persisted so later views (recipient, or the sender revisiting without the URL param) know the real value instead of guessing.', minimum: 1, maximum: 15 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  split?: number;

  @ApiPropertyOptional({ description: "MagicBlock private-transfer max delivery delay in ms — the transfer endpoint documents no maximum; this app's own UI ceiling is 7 days (604800000ms), chosen on the Send form and persisted for the same reason as split.", minimum: 0, maximum: 604_800_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(604_800_000)
  maxDelayMs?: number;

  // Server-side only — stripped from request body by ValidationPipe whitelist.
  userId?: string;
  /** ISO timestamp — claim auto-expires (EXPIRED) if still unsettled past this. Server-side only. */
  expiresAt?: string;
}
