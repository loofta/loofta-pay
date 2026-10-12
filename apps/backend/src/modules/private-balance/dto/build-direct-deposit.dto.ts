import { IsNumber, IsInt, Min, Max, IsString, IsNotEmpty, MaxLength, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BuildDirectDepositDto {
  @ApiProperty({ example: 25 })
  @IsNumber()
  @Min(1)
  @Max(2000)
  amount_usdc: number;

  @ApiProperty({ description: 'Connected external Solana wallet funding this deposit' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  source_wallet_address: string;

  @ApiPropertyOptional({ enum: ['devnet', 'mainnet'] })
  @IsOptional()
  @IsString()
  @IsIn(['devnet', 'mainnet'])
  cluster?: 'devnet' | 'mainnet';

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  split?: number;

  @ApiPropertyOptional({ example: 300000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400_000)
  max_delay_ms?: number;
}
