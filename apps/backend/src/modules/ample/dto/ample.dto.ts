import { IsString, IsNotEmpty, IsIn, IsOptional, IsBoolean, MaxLength, Matches } from 'class-validator';

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
  /** Retry path: ask for the plain transaction (user pays the network fee) if the sponsored one is rejected by the wallet. */
  @IsOptional() @IsBoolean()
  plain?: boolean;
}

export class AmpleClaimDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  payoutId: string;
  @IsOptional() @IsBoolean()
  plain?: boolean;
}

export class AmpleEventDto {
  @IsIn(['deposit', 'withdraw', 'claim'])
  kind: 'deposit' | 'withdraw' | 'claim';
  @IsString() @IsNotEmpty() @MaxLength(80)
  vaultId: string;
  @IsString() @Matches(/^[0-9]{1,30}$/)
  amountBase: string;
  @IsString() @IsNotEmpty() @MaxLength(120)
  txSignature: string;
  @IsOptional() @IsString() @MaxLength(64)
  payoutId?: string;
}
