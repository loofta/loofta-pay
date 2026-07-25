import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  recipient: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  otp: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  deviceUuid: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  os?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  browser?: string;
}
