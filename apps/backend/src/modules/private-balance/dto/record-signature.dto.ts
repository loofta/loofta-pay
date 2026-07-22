import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RecordWithdrawalSignatureDto {
  @ApiProperty({ description: 'Base58 Solana transaction signature of the broadcast leg-1 (user -> burner) private transfer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  signature: string;
}
