import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
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
}
