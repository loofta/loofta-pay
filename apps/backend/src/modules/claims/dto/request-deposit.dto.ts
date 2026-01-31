import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, MaxLength, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class FromTokenDto {
  @ApiProperty({ description: 'Token ID (asset ID)' })
  @IsString()
  @IsNotEmpty()
  tokenId: string;

  @ApiProperty({ description: 'Token symbol', example: 'ETH' })
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @ApiProperty({ description: 'Blockchain chain', example: 'eth' })
  @IsString()
  @IsNotEmpty()
  chain: string;

  @ApiProperty({ description: 'Token decimals', example: 18 })
  @IsNumber()
  decimals: number;
}

export class RequestDepositDto {
  @ApiProperty({ description: 'Claim UUID' })
  @IsUUID()
  @IsNotEmpty()
  claimId: string;

  @ApiProperty({ description: 'Source token details', type: FromTokenDto })
  @ValidateNested()
  @Type(() => FromTokenDto)
  fromToken: FromTokenDto;

  @ApiProperty({ description: 'Amount to deposit', example: '0.05' })
  @IsString()
  @IsNotEmpty()
  amount: string;

  @ApiPropertyOptional({ description: 'User wallet address for refunds' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  userAddress?: string;

  @ApiPropertyOptional({ description: 'Refund address (required for refunds)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refundAddress?: string;

  @ApiPropertyOptional({ description: 'Organization referral code' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  orgReferral?: string;

  @ApiPropertyOptional({ description: 'Whether this is a private payment (cross-chain to Solana requires login)' })
  @IsOptional()
  isPrivate?: boolean;

  @ApiPropertyOptional({ description: 'Recipient Solana address (required for private cross-chain to Solana - use your embedded Loofta wallet)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  recipientSolanaAddress?: string;
}
