import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsBoolean, IsIn, IsNotEmpty, Min, Max, MaxLength } from 'class-validator';

export const PAYOUT_RECIPIENT_TYPES = ['email', 'username', 'twitter', 'discord', 'github', 'telegram'] as const;
export type PayoutRecipientType = (typeof PAYOUT_RECIPIENT_TYPES)[number];

// gram_ton pays with native TON coin (NEAR Intents/most bridges label it "GRAM", TON's original
// pre-launch name) rather than the USDT jetton — a plain value transfer needs no jetton-wallet
// "notify" step, sidestepping the gas-starved-notification failure the USDT route was prone to.
export const PAYOUT_FUNDING_SOURCES = ['gram_ton', 'usdc_base', 'usdc_stellar'] as const;
export type PayoutFundingSource = (typeof PAYOUT_FUNDING_SOURCES)[number];

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

  @ApiPropertyOptional({ description: 'Your own Solana wallet — pays gas and signs the returned transaction. Required unless funding_source is set. Never touched by Loofta.', example: '5dCT...BKuq' })
  @IsOptional()
  @IsString()
  sender_wallet?: string;

  @ApiPropertyOptional({
    description: 'Fund this payout from a wallet on another chain instead of signing a Solana transaction. When set, omit sender_wallet — the response returns a deposit address and the exact amount to send there instead of an unsigned transaction. refund_wallet is required alongside this.',
    enum: PAYOUT_FUNDING_SOURCES,
    example: 'usdc_base',
  })
  @IsOptional()
  @IsString()
  @IsIn(PAYOUT_FUNDING_SOURCES)
  funding_source?: PayoutFundingSource;

  @ApiPropertyOptional({ description: 'Your address on the funding_source chain, used to refund you if the deposit can\'t be completed. Required when funding_source is set.', example: 'EQC...abcd' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refund_wallet?: string;

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
