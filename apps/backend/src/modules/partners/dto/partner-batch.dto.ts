import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNotEmpty, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_BATCH_ROWS, PayoutBatchRowDto } from '@/modules/payouts/dto/create-payout-batch.dto';

export class CreatePartnerBatchDto {
  @ApiProperty({ description: 'Unique per batch. Resending the same key returns the existing batch instead of creating a second one.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  idempotency_key: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiProperty({ type: [PayoutBatchRowDto], description: `1 to ${MAX_BATCH_ROWS} payouts` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_ROWS)
  @ValidateNested({ each: true })
  @Type(() => PayoutBatchRowDto)
  rows: PayoutBatchRowDto[];
}

export class ApproveBatchDto {
  @ApiProperty({ description: 'The rows_hash the approver was shown. The approval only applies if the batch still has exactly these rows.' })
  @IsString()
  @Length(64, 64)
  rows_hash: string;
}

export class PrepareBatchDto {
  @ApiPropertyOptional({ description: 'Only for the personal-wallet fallback. Partners with a company wallet always fund from it.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sender_wallet?: string;
}

export class ConfirmBatchDto {
  @ApiProperty({ type: [String], description: 'Signatures of the funding transactions that were broadcast' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_ROWS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  signatures: string[];
}
