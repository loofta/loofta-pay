import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, MaxLength, ValidateNested, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class StartLoginDto {
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) scopes?: string[];
}
export class TokenRequestDto {
  @IsString() @MaxLength(100) device_code: string;
}
export class UserCodeDto {
  @IsString() @MaxLength(20) user_code: string;
}
export class ApproveLoginDto extends UserCodeDto {
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) scopes?: string[];
  @IsOptional() @IsNumber() per_payment_cap_usd?: number;
  @IsOptional() @IsNumber() daily_cap_usd?: number;
  @IsOptional() @IsNumber() auto_approve_usd?: number;
  @IsOptional() @IsInt() @Min(1) @Max(90) expires_in_days?: number;
}
export class PaymentItemDto {
  @IsString() @MaxLength(64) recipient: string;
  @IsNumber() amount_usd: number;
}
export class QuoteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => PaymentItemDto) payments: PaymentItemDto[];
  @IsOptional() @IsBoolean() privately?: boolean;
  @IsOptional() @IsNumber() delay_minutes?: number;
  @IsOptional() @IsNumber() split?: number;
}
