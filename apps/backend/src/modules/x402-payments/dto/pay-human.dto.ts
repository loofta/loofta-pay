import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, IsIn, Min, Max, MaxLength } from 'class-validator';
import type { PayHumanRecipientType } from '../burner-payment.service';

const RECIPIENT_TYPES: PayHumanRecipientType[] = ['email', 'username', 'twitter', 'discord', 'github', 'telegram'];

export class PayHumanDto {
  @ApiProperty({ enum: RECIPIENT_TYPES, description: 'How the recipient is identified' })
  @IsString()
  @IsIn(RECIPIENT_TYPES)
  recipient_type: PayHumanRecipientType;

  @ApiProperty({ description: 'Email address, username, or social handle (no @ needed)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  recipient_identifier: string;

  @ApiProperty({ description: 'Amount in USD', example: 5 })
  @IsNumber()
  @Min(0.01)
  @Max(10000)
  amount_usd: number;

  @ApiPropertyOptional({ description: 'Optional note attached to the payment' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;
}
