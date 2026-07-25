import { IsIn, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateOnrampDto {
  @IsNumber()
  @Min(1)
  fiatAmount: number;

  @IsOptional()
  @IsIn(['NGN', 'GHS', 'TZS', 'KES', 'ZAR', 'USD'])
  currency?: 'NGN' | 'GHS' | 'TZS' | 'KES' | 'ZAR' | 'USD';
}
