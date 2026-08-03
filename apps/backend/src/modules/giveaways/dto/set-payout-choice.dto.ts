import { IsIn, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetPayoutChoiceDto {
  @ApiProperty({ enum: ['public', 'private'], description: 'Default should be private in the UI — public is an explicit opt-out.' })
  @IsIn(['public', 'private'])
  choice: 'public' | 'private';

  @ApiProperty({ description: 'Solana wallet address to receive the prize' })
  @IsString()
  @IsNotEmpty()
  destination: string;
}
