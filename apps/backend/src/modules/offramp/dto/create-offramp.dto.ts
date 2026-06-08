import { IsString, IsNotEmpty, IsNumber, Min, MaxLength } from 'class-validator';

export class CreateOfframpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  platform: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  identifier: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  currency: string;

  @IsNumber()
  @Min(1)
  amountUSDC: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  solanaAddress: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(42)
  baseWalletAddress: string;
}
