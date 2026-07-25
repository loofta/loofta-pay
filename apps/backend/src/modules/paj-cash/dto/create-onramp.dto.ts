import { IsIn, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateOnrampDto {
  @IsNumber()
  @Min(0.01)
  amountUsdc: number;

  @IsOptional()
  @IsIn(['NGN', 'GHS', 'TZS', 'KES', 'ZAR', 'USD'])
  currency?: 'NGN' | 'GHS' | 'TZS' | 'KES' | 'ZAR' | 'USD';
}
