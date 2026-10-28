import { IsInt, IsNumber, Min, Max, IsString, IsNotEmpty, MaxLength, IsOptional, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TokenRefDto } from './token-ref.dto';

export class BuildPrivateWithdrawalDto {
  @ApiProperty({ example: 25 })
  @IsNumber()
  @Min(1)
  @Max(2000)
  amount_usdc: number;

  @ApiProperty({ description: 'Destination Solana wallet address' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  destination_address: string;

  /** Omit for USDC on Solana (direct — no Near Intents leg). Provide for any other destination token/chain. */
  @ApiPropertyOptional({ type: TokenRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TokenRefDto)
  destination_token?: TokenRefDto;

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

  @ApiPropertyOptional({ enum: ['devnet', 'mainnet'] })
  @IsOptional()
  @IsString()
  @IsIn(['devnet', 'mainnet'])
  cluster?: 'devnet' | 'mainnet';
}
