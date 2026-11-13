import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class PumpTradeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(MINT, { message: 'mint must be a Solana mint address' })
  mint: string;

  @IsIn(['buy', 'sell'])
  side: 'buy' | 'sell';

  /** Buy: SOL to spend, fees included. Sell: number of coins to sell. A positive decimal string. */
  @IsString()
  @Matches(/^\d{1,18}(\.\d{1,9})?$/, { message: 'amount must be a positive decimal string' })
  amount: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(2000)
  slippageBps?: number;
}
