import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsISO8601, IsNotEmpty, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'ISO 8601 time to run this batch, between 5 minutes and 90 days from now. At that time Loofta prepares the payouts and asks the company wallet signers to approve the funding. Leave out to run it as soon as it is approved.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  scheduled_for?: string;

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
