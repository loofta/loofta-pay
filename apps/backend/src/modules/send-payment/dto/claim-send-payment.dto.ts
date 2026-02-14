import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject } from 'class-validator';

export class ClaimSendPaymentDto {
  @ApiPropertyOptional({
    description: 'If set, trigger NEAR intent to send from embedded wallet to this destination after crediting',
  })
  @IsOptional()
  @IsObject()
  forward_to?: {
    chain: string;
    token: string;
    address: string;
  };
}
