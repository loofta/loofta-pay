import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PAYOUT_RECIPIENT_TYPES, PayoutRecipientType } from './create-payout.dto';

export const MAX_BATCH_ROWS = 100;

export class PayoutBatchRowDto {
  @ApiProperty({ example: 25 })
  @IsNumber()
  @Min(0.01)
  @Max(10000)
  amount: number;

  @ApiProperty({ enum: PAYOUT_RECIPIENT_TYPES, example: 'email' })
  @IsString()
  @IsIn(PAYOUT_RECIPIENT_TYPES)
  recipient_type: PayoutRecipientType;

  @ApiProperty({ example: 'alice@example.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  recipient_identifier: string;

  @ApiPropertyOptional({ description: 'Your own reference for this row (user id, invoice id). Returned as-is.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  external_ref?: string;

  @ApiPropertyOptional({ description: 'Message the recipient sees on the claim page' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class CreatePayoutBatchDto {
  @ApiProperty({ description: 'Unique per batch. Resending the same key returns the existing batch status instead of paying twice.', example: 'clipur-2026-11-payouts' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  idempotency_key: string;

  @ApiPropertyOptional({ example: 'November creator payouts' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiProperty({ description: `Your own Solana wallet. Signs every returned transaction. Never touched by Loofta.` })
  @IsString()
  @IsNotEmpty()
  sender_wallet: string;

  @ApiPropertyOptional({ description: 'Shield amounts and your wallet from public view. $1 minimum per row.', default: false })
  @IsOptional()
  @IsBoolean()
  is_private?: boolean;

  @ApiProperty({ type: [PayoutBatchRowDto], description: `1 to ${MAX_BATCH_ROWS} payouts per batch` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_ROWS)
  @ValidateNested({ each: true })
  @Type(() => PayoutBatchRowDto)
  rows: PayoutBatchRowDto[];
}
