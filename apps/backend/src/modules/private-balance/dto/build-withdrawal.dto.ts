import { IsNumber, Min, Max, IsString, IsNotEmpty, MaxLength, IsOptional, ValidateNested, IsIn } from 'class-validator';
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

  @ApiPropertyOptional({ enum: ['devnet', 'mainnet'] })
  @IsOptional()
  @IsString()
  @IsIn(['devnet', 'mainnet'])
  cluster?: 'devnet' | 'mainnet';
}
