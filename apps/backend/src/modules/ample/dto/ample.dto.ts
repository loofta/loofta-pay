import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class AmpleChallengeDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  walletAddress: string;
}

export class AmpleLinkDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  walletAddress: string;
  @IsString() @IsNotEmpty() @MaxLength(2000)
  message: string;
  @IsString() @IsNotEmpty() @MaxLength(300)
  signature: string;
}

/** Amount is a base-unit integer string, never a number. */
export class AmpleAmountDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  vaultId: string;
  @IsString() @Matches(/^[1-9][0-9]{0,30}$/)
  amount: string;
}

export class AmpleClaimDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  payoutId: string;
}
