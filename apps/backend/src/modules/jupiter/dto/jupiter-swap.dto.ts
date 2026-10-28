import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class JupiterSwapDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(MINT, { message: 'inputMint must be a Solana mint address' })
  inputMint: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(MINT, { message: 'outputMint must be a Solana mint address' })
  outputMint: string;

  /** Human-readable amount of the input token as a decimal string. Decimals come from the mint on-chain. */
  @IsString()
  @Matches(/^\d{1,18}(\.\d{1,18})?$/, { message: 'amount must be a positive decimal string' })
  amount: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(1000)
  slippageBps?: number;
}
