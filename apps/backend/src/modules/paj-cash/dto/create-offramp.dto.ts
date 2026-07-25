import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateOfframpDto {
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;

  @IsNumber()
  @Min(0.01)
  amountUsdc: number;

  @IsOptional()
  @IsIn(['NGN', 'GHS', 'TZS', 'KES', 'ZAR', 'USD'])
  currency?: 'NGN' | 'GHS' | 'TZS' | 'KES' | 'ZAR' | 'USD';
}
