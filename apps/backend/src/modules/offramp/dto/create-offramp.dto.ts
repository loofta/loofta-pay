import { IsString, IsNotEmpty, IsNumber, IsBoolean, IsOptional, Min, MaxLength } from 'class-validator';

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

  /**
   * Treat amountUSDC as the most the user can spend, bridge fee included (a claimed payment cashing
   * out: they only hold what they were sent). The gross is shrunk until the whole bridge fits.
   */
  @IsOptional()
  @IsBoolean()
  coverBridgeFee?: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  solanaAddress: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(42)
  baseWalletAddress: string;
}
