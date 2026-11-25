import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ProposeTreasuryConfigDto {
  @ApiPropertyOptional({ description: 'Active team members to add to the company wallet. Their own Loofta wallet becomes a signer.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  add_member_ids?: string[];

  @ApiPropertyOptional({ description: 'Team members to remove from the company wallet.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  remove_member_ids?: string[];

  @ApiPropertyOptional({ description: 'How many approvals a payout or change needs. Owner only.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(25)
  threshold?: number;
}

export class ProposeTreasuryWithdrawDto {
  @ApiPropertyOptional({ description: 'Solana wallet address to send the USDC to.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  destination_address: string;

  @ApiPropertyOptional({ description: 'How much USDC the destination receives. Network fees are taken on top.' })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 })
  @Min(0.01)
  @Max(10_000_000)
  amount_usdc: number;
}

export class ConfirmTreasuryTxDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  signature: string;
}
