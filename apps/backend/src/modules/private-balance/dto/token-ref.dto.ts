import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Non-Solana-USDC source/destination token for the cross-chain (Near Intents) leg.
 * Not yet wired up — reserved for the cross-chain stage of private deposit/withdrawal.
 */
export class TokenRefDto {
  @ApiProperty({ example: 'ETH' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  symbol: string;

  @ApiProperty({ example: 'ethereum' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  chain: string;
}
