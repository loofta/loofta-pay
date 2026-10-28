import { IsInt, IsOptional, IsString, IsNotEmpty, Max, MaxLength, Matches, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';

export class BuildPrivateTokenWithdrawalDto {
  @ApiProperty({ description: 'SPL token mint to send (classic Token program only)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  mint: string;

  /** Human-readable amount as a decimal string — decimals are read from the mint on-chain, never from the client. */
  @ApiProperty({ example: '12.5' })
  @IsString()
  @Matches(/^\d{1,18}(\.\d{1,18})?$/, { message: 'amount must be a positive decimal string' })
  amount: string;

  @ApiProperty({ description: 'Destination Solana wallet address' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  destination_address: string;

  /** Delivery split count, 1-15 (MagicBlock's documented range). Omit for the automatic split. */
  @ApiPropertyOptional({ minimum: 1, maximum: 15 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  split?: number;

  /** Longest random delay before delivery, in ms (0 = instant, up to 31 days). Omit for the default window. */
  @ApiPropertyOptional({ minimum: 0, maximum: 2678400000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2678400000)
  max_delay_ms?: number;
}
