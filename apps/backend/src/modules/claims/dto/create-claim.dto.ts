import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, MaxLength, IsBoolean } from 'class-validator';


export class TokenSelectionDto {
  @ApiProperty({ description: 'Token symbol', example: 'USDC' })
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @ApiProperty({ description: 'Blockchain chain', example: 'base' })
  @IsString()
  @IsNotEmpty()
  chain: string;
}

export class CreateClaimDto {
  @ApiProperty({ description: 'Amount in USD', example: 100 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Destination token selection', type: TokenSelectionDto })
  toSel: TokenSelectionDto;

  @ApiProperty({ description: 'Recipient wallet address' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  recipient: string;

  @ApiPropertyOptional({ description: 'When true, payment must use Privacy Cash (private payment)' })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  // Server-side only — stripped from request body by ValidationPipe whitelist,
  // then re-injected from the verified auth token in the controller.
  userId?: string;
}
