import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitKycDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  idNumber: string;

  @IsIn(['BVN', 'NIN'])
  idType: 'BVN' | 'NIN';

  @IsOptional()
  @IsIn(['NG', 'GH', 'TZ', 'KE', 'ZA'])
  country?: 'NG' | 'GH' | 'TZ' | 'KE' | 'ZA';
}
