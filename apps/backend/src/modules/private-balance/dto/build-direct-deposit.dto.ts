import { IsNumber, Min, Max, IsString, IsNotEmpty, MaxLength, IsOptional, IsIn } from 'class-validator';
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
}
