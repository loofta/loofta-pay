import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class BuildFundingPrivateTransferDto {
  @ApiProperty({ description: "Creator's own wallet address, paying into the giveaway burner" })
  @IsString()
  sender_wallet: string;

  @ApiPropertyOptional({ enum: ['devnet', 'mainnet'] })
  @IsOptional()
  @IsIn(['devnet', 'mainnet'])
  cluster?: 'devnet' | 'mainnet';

  @ApiPropertyOptional({ description: 'MagicBlock gasless relay (default true — no SOL needed from the creator)' })
  @IsOptional()
  @IsBoolean()
  gasless?: boolean;
}

export class ConfirmDirectTokenFundingDto {
  @ApiProperty({ description: 'Signature of the token-plus-fee funding transaction' })
  @IsString()
  signature: string;
}
