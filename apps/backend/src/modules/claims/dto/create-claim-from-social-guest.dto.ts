import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max, IsInt, IsBoolean, MaxLength, IsIn } from 'class-validator';

/** Same shape as CreateClaimFromSocialDto, plus turnstileToken — see
 *  create-claim-from-email-guest.dto.ts for why, and for what isPrivate does here. */
export class CreateClaimFromSocialGuestDto {
  @ApiProperty({ description: 'Social platform', enum: ['discord', 'github', 'telegram'] })
  @IsString()
  @IsIn(['discord', 'github', 'telegram'])
  platform: 'discord' | 'github' | 'telegram';

  @ApiProperty({ description: 'Handle on that platform (with or without @ prefix)', example: 'octocat' })
  @IsString()
  @IsNotEmpty()
  handle: string;

  @ApiProperty({ description: 'Amount in USD', example: 100 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Whether this is a private payment', default: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiPropertyOptional({ description: 'Payment description/message (supports emojis and GIFs)', example: '🍕 Pizza party! 🎉' })
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

  @ApiPropertyOptional({ description: "MagicBlock private-transfer max delivery delay in ms — the transfer endpoint documents no maximum; this app's own UI ceiling is 7 days (604800000ms), chosen on the Send form and persisted for the same reason as split.", minimum: 0, maximum: 604_800_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(604_800_000)
  maxDelayMs?: number;

  @ApiProperty({ description: 'Cloudflare Turnstile token from the guest-facing widget' })
  @IsString()
  @IsNotEmpty()
  turnstileToken: string;
}
