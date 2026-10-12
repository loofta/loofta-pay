import { IsNumber, IsInt, Min, Max, IsOptional, ValidateNested, IsIn, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TokenRefDto } from './token-ref.dto';

export class StartPrivateDepositDto {
  /** USDC amount, required only when depositing USDC on Solana directly (no source_token). */
  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(2000)
  amount_usdc?: number;

  /** Omit for USDC on Solana (direct — no Near Intents leg). Provide for any other source token/chain. */
  @ApiPropertyOptional({ type: TokenRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TokenRefDto)
  source_token?: TokenRefDto;

  /** Amount of source_token to send (that token's own units, not USD). Required when source_token is set. */
  @ApiPropertyOptional({ example: 0.05 })
  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  source_amount?: number;

  @ApiPropertyOptional({ enum: ['devnet', 'mainnet'] })
  @IsOptional()
  @IsString()
  @IsIn(['devnet', 'mainnet'])
  cluster?: 'devnet' | 'mainnet';

  /** MagicBlock delivery split for the burner → wallet hop. 1 = one payment. */
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  split?: number;

  /** Upper bound of MagicBlock's random delivery delay, in ms. */
  @ApiPropertyOptional({ example: 300000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400_000)
  max_delay_ms?: number;
}
