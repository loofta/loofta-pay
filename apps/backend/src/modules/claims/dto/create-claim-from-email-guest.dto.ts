import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PRIVACY_TRANSFER_MAX_DELAY_MS } from '../../../common/privacy-transfer-limit';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max, IsInt, IsBoolean, MaxLength, IsEmail } from 'class-validator';

/** Same shape as CreateClaimFromEmailDto, plus turnstileToken (required since this endpoint has
 *  no AuthGuard to lean on for abuse protection). isPrivate here works the same as it does for
 *  the authenticated create-from-email: leave it off and the payer decides at pay time on
 *  /c/[id]'s own incognito toggle (GuestCheckoutPay's, for this flow); set it true to lock the
 *  claim into private up front. */
export class CreateClaimFromEmailGuestDto {
  @ApiProperty({ description: 'Recipient email (they claim by signing in with this email)', example: 'alice@example.com' })
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Amount in USD', example: 100 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Whether this is a private payment', default: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiPropertyOptional({ description: 'Payment description/message' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Solana cluster for this payment', enum: ['devnet', 'mainnet'] })
  @IsOptional()
  @IsString()
  cluster?: 'devnet' | 'mainnet';

  @ApiPropertyOptional({ description: 'MagicBlock private-transfer split (1-15), chosen on the Send form — persisted so later views (recipient, or the sender revisiting without the URL param) know the real value instead of guessing.', minimum: 1, maximum: 15 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  split?: number;

  @ApiPropertyOptional({ description: "MagicBlock private-transfer max delivery delay in ms. The privacy API allows up to 31 days. Chosen on the Send form and persisted so later views quote that same wait.", minimum: 0, maximum: PRIVACY_TRANSFER_MAX_DELAY_MS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRIVACY_TRANSFER_MAX_DELAY_MS)
  maxDelayMs?: number;

  @ApiProperty({ description: 'Cloudflare Turnstile token from the guest-facing widget' })
  @IsString()
  @IsNotEmpty()
  turnstileToken: string;
}
