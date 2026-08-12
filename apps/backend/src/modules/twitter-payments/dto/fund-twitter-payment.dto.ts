import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';

export class FundTwitterPaymentDto {
  /** Sender's choice on the funding page. Defaults to true (private) server-side when omitted —
   *  preserves today's always-private behavior for any caller that doesn't yet send this field. */
  @ApiPropertyOptional({ description: 'Fund privately (default true, preserving current behavior)' })
  @IsOptional()
  @IsBoolean()
  is_private?: boolean;
}
