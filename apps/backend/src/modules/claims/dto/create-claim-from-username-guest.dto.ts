import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PRIVACY_TRANSFER_MAX_DELAY_MS } from '../../../common/privacy-transfer-limit';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max, IsInt, IsBoolean, MaxLength } from 'class-validator';

/** Same shape as CreateClaimFromUsernameDto, plus turnstileToken — see
 *  create-claim-from-email-guest.dto.ts for why. Guest send only reaches this via the Twitter
 *  option in the social picker (treatUnregisteredAsTwitter always true from that caller) — a
 *  real Loofta username isn't offered as a guest-pickable send method (see app/app/page.tsx). */
export class CreateClaimFromUsernameGuestDto {
  @ApiProperty({ description: 'Username or Twitter handle (with or without @ prefix)', example: 'satoshi' })
  @IsString()
  @IsNotEmpty()
  username: string;

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

  @ApiPropertyOptional({ description: 'Tag an unresolved handle as pending-Twitter (see CreateClaimFromUsernameDto)', default: false })
  @IsOptional()
  @IsBoolean()
  treatUnregisteredAsTwitter?: boolean;

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
