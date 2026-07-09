import { IsString, IsNotEmpty, IsNumber, Min, MaxLength, IsIn } from 'class-validator';

export const BEAM_PLATFORMS = ['venmo', 'cashapp', 'revolut'] as const;
export type BeamPlatform = (typeof BEAM_PLATFORMS)[number];

export const BEAM_PLATFORM_CAPS: Record<BeamPlatform, number> = {
  venmo: 100,
  cashapp: 100,
  revolut: 100,
};

export const BEAM_FUNDING_METHODS = ['blink', 'near-intents', 'coinbase', 'moonpay', 'balance'] as const;
export type BeamFundingMethod = (typeof BEAM_FUNDING_METHODS)[number];

// Fixed 1:0.998 rate for all Beam platforms — independent of the withdraw feature's spread.
export const BEAM_RATE = 0.998;

// Venmo/Cash App are USD-only fiat rails; Revolut can pay out in EUR too.
export const BEAM_CURRENCIES = ['USD', 'EUR'] as const;
export type BeamCurrency = (typeof BEAM_CURRENCIES)[number];

export class CreateBeamDto {
  @IsString()
  @IsIn(BEAM_PLATFORMS)
  platform: BeamPlatform;

  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  identifier: string;

  // Always the sender's actual USDC payment (gross, spread already absorbed) — never
  // the recipient's local-currency receive amount, regardless of `currency` below.
  @IsNumber()
  @Min(1)
  amountUSDC: number;

  // What currency amountPayout (computed server-side as amountUSDC * BEAM_RATE) should be
  // labeled as — the frontend has already converted the recipient's EUR receive amount into
  // USDC using its own live FX rate before calling us; this field is for display/record-keeping.
  @IsString()
  @IsIn(BEAM_CURRENCIES)
  currency: BeamCurrency;

  @IsString()
  @IsNotEmpty()
  @MaxLength(42)
  baseWalletAddress: string;
}
