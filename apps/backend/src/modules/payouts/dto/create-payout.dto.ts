import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsBoolean, IsIn, IsNotEmpty, Min, Max, MaxLength } from 'class-validator';

export const PAYOUT_RECIPIENT_TYPES = ['email', 'username', 'twitter', 'discord', 'github', 'telegram'] as const;
export type PayoutRecipientType = (typeof PAYOUT_RECIPIENT_TYPES)[number];

export class CreatePayoutDto {
  @ApiProperty({ description: 'Amount in USD the recipient should receive. $1 minimum if public (the default), $5 minimum if private.', example: 25 })
  @IsNumber()
  @Min(1)
  @Max(10000)
  amount: number;

  @ApiProperty({ description: 'How the recipient is identified', enum: PAYOUT_RECIPIENT_TYPES, example: 'email' })
  @IsString()
  @IsIn(PAYOUT_RECIPIENT_TYPES)
  recipient_type: PayoutRecipientType;

  @ApiProperty({ description: 'Email address, @username, or handle, matching recipient_type', example: 'alice@example.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  recipient_identifier: string;

  @ApiProperty({ description: 'Your own Solana wallet — pays gas and signs the returned transaction. Never touched by Loofta.', example: '5dCT...BKuq' })
  @IsString()
  @IsNotEmpty()
  sender_wallet: string;

  @ApiPropertyOptional({ description: 'Message the recipient sees on the claim page' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @ApiPropertyOptional({
    description: 'Shield the amount and your wallet from public view. Defaults to false. $5 minimum (MagicBlock\'s private-transfer floor).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_private?: boolean;
}
