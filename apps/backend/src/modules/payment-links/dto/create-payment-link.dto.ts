import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsBoolean, IsUrl, Min, Max, MaxLength } from 'class-validator';

export class CreatePaymentLinkDto {
  // $1 floor at the DTO level — the service enforces the real $5 floor only when is_private
  // resolves to true (MagicBlock's private-transfer minimum); a public transfer has no such
  // constraint.
  @ApiProperty({ description: 'Amount in USD the recipient should receive. $1 minimum if public (the default), $5 minimum if private.', example: 25 })
  @IsNumber()
  @Min(1)
  @Max(10000)
  amount: number;

  @ApiPropertyOptional({ description: 'Message shown to the payer on the checkout page' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiPropertyOptional({
    description: 'Whether the payer must pay privately. Defaults to false — the recipient can already choose to claim privately at claim time.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_private?: boolean;

  @ApiPropertyOptional({
    description:
      'POSTed with a signed "payment.succeeded" event once this link is paid. A one-time webhook_secret is returned alongside the created link — never retrievable again — to verify the X-Loofta-Signature header.',
  })
  @IsOptional()
  @IsUrl({ require_tld: false }) // require_tld: false so http://localhost:*/webhook works while testing
  webhook_url?: string;
}
