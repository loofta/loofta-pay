import { IsString, IsNotEmpty, IsIn, IsOptional, IsBoolean, IsArray, ArrayMinSize, ArrayMaxSize, MaxLength, Matches } from 'class-validator';

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

/** EVM (Base) amounts: USDC base units, no vault id because the server picks the Base USDC vault itself. */
export class AmpleEvmAmountDto {
  @IsString() @Matches(/^[1-9][0-9]{0,30}$/)
  amount: string;
}

export class AmpleEvmClaimDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @IsString({ each: true }) @MaxLength(64, { each: true })
  payoutIds: string[];
}

/** Move Solana USDC to the person's own Base wallet (USDC base units, as digit strings). */
export class AmpleFundPrepareDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  solanaAddress: string;
  @IsString() @Matches(/^[1-9][0-9]{0,15}$/)
  outputUnits: string;
  @IsOptional() @IsString() @Matches(/^[1-9][0-9]{0,15}$/)
  maxTotalUnits?: string;
  /** Add through NEAR Confidential Intents (extra $0.25) so the wallet is not linked to the Earn account. */
  @IsOptional() @IsBoolean()
  confidential?: boolean;
}

export class AmpleFundBroadcastDto {
  @IsString() @IsNotEmpty() @MaxLength(20000)
  transaction: string;
}

export class AmpleFundWithdrawDto {
  @IsString() @Matches(/^[1-9][0-9]{0,15}$/)
  amount: string;
  @IsString() @IsNotEmpty() @MaxLength(64)
  solanaAddress: string;
  /** Return through NEAR Confidential Intents. Defaults to on for anyone who added privately. */
  @IsOptional() @IsBoolean()
  confidential?: boolean;
}
