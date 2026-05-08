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
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MultiSendRecipientDto {
  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(5)
  amount: number;

  @ApiProperty({ enum: ['email', 'twitter', 'username'] })
  @IsString()
  @IsIn(['email', 'twitter', 'username'])
  recipient_type: 'email' | 'twitter' | 'username';

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
