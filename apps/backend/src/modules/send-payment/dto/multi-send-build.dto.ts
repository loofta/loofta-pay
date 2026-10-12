import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  Max,
  IsInt,
  IsIn,
  MaxLength,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const MULTI_SEND_MIN_TOTAL_USD = 5;

/** Sum of recipient amounts must reach the platform minimum, even though individual rows can be smaller. */
function MinTotalAmount(minTotal: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'minTotalAmount',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [minTotal],
      validator: {
        validate(recipients: unknown, args: ValidationArguments) {
          const [min] = args.constraints as [number];
          if (!Array.isArray(recipients)) return true;
          const total = recipients.reduce(
            (sum: number, r: { amount?: unknown }) => sum + (Number(r?.amount) || 0),
            0,
          );
          return total >= min;
        },
        defaultMessage(args: ValidationArguments) {
          const [min] = args.constraints as [number];
          return `Total amount across all recipients must be at least $${min}`;
        },
      },
    });
  };
}

export class MultiSendRecipientDto {
  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ enum: ['email', 'twitter', 'username', 'discord', 'github', 'telegram'] })
  @IsString()
  @IsIn(['email', 'twitter', 'username', 'discord', 'github', 'telegram'])
  recipient_type: 'email' | 'twitter' | 'username' | 'discord' | 'github' | 'telegram';

  @ApiProperty({ example: 'alice@example.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  recipient_identifier: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class BuildMultiSendDto {
  @ApiProperty({ type: [MultiSendRecipientDto], minItems: 2, maxItems: 10 })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @Type(() => MultiSendRecipientDto)
  @MinTotalAmount(MULTI_SEND_MIN_TOTAL_USD)
  recipients: MultiSendRecipientDto[];

  @ApiProperty({ description: 'Sender Solana wallet pubkey' })
  @IsString()
  @IsNotEmpty()
  sender_wallet: string;

  @ApiPropertyOptional({ enum: ['devnet', 'mainnet'] })
  @IsOptional()
  @IsString()
  @IsIn(['devnet', 'mainnet'])
  cluster?: 'devnet' | 'mainnet';

  @ApiPropertyOptional({ description: 'MagicBlock split (1-15) applied to every recipient payout in this batch.', minimum: 1, maximum: 15 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  split?: number;

  @ApiPropertyOptional({ description: 'MagicBlock max delivery delay in ms, applied to every recipient payout. 0 means no delay. UI ceiling is 7 days.', minimum: 0, maximum: 604_800_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(604_800_000)
  maxDelayMs?: number;
}

/** Step 2 of the private flow: build the sender's one funding transfer (sender → this batch's
 *  fresh throwaway burner) for a batch that multi-create (createMultiPayments) already created. */
export class BuildMultiSendFundingDto {
  @ApiProperty({ description: 'multi_send_batch_id returned by multi-create' })
  @IsString()
  @IsNotEmpty()
  multi_send_batch_id: string;

  @ApiProperty({ description: 'Sender Solana wallet pubkey' })
  @IsString()
  @IsNotEmpty()
  sender_wallet: string;

  @ApiPropertyOptional({ enum: ['devnet', 'mainnet'] })
  @IsOptional()
  @IsString()
  @IsIn(['devnet', 'mainnet'])
  cluster?: 'devnet' | 'mainnet';
}

/** Step 3 of the private flow: sender has broadcast the funding transfer — flip this batch's
 *  rows to IN_FLIGHT and kick off the server-side fan-out from the batch's own burner. */
export class ConfirmMultiSendFundingDto {
  @ApiProperty({ description: 'multi_send_batch_id returned by multi-create' })
  @IsString()
  @IsNotEmpty()
  multi_send_batch_id: string;

  @ApiPropertyOptional({ description: 'Funding transfer signature, for logging' })
  @IsOptional()
  @IsString()
  tx_hash?: string;
}

/** Public combined-tx path: mark payments transferred after the sender's own signature confirms.
 *  tx_hash's actual signature shape is checked in confirmMultiSend (isValidSolanaSignature) —
 *  kept out of this DTO so a malformed value fails inside the service, where it gets logged with
 *  the caller's IP for abuse tracking rather than silently 400ing at the pipe. */
export class ConfirmMultiSendDto {
  @ApiProperty({ type: [String], description: 'payment.id values returned by multi-build' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  payment_ids: string[];

  @ApiPropertyOptional({ description: 'Sender wallet transaction signature' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  tx_hash?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  fee_usdc?: number;
}
