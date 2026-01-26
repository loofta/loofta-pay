import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, IsEmail } from 'class-validator';

export class CreateClaimFromUsernameDto {
  @ApiProperty({ description: 'Username (with or without @ prefix)', example: 'looftaxyz' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ description: 'Amount in USD', example: 100 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Privy user ID who created the claim' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Creator email address' })
  @IsOptional()
  @IsEmail()
  userEmail?: string;
}
