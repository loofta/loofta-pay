import { IsString, IsNotEmpty, IsNumber, Min, MaxLength } from 'class-validator';

export class PrepareSolWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  solanaAddress: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  destinationAddress: string;

  @IsNumber()
  @Min(1)
  amountUSDC: number;
}
