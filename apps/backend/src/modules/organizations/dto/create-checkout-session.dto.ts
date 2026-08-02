import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, MaxLength, IsBoolean, IsUrl } from 'class-validator';

export class CreateCheckoutSessionDto {
  @ApiProperty({ description: 'Amount in USD', example: 25 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Optional description shown to the payer' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @ApiPropertyOptional({ description: 'Route this checkout payment privately' })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiPropertyOptional({ description: 'Redirect URL after a successful payment' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2000)
  callbackUrl?: string;
}
