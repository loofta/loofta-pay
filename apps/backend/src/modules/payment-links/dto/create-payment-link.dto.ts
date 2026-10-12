import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsBoolean, IsUrl, Min, Max, MaxLength } from 'class-validator';

export class CreatePaymentLinkDto {
  // One-cent floor at the DTO level — the service enforces the real $1 floor only when is_private
  // resolves to true; a public transfer has no such constraint.
  @ApiProperty({ description: 'Amount in USD the recipient should receive. $0.01 minimum if public (the default), $1 minimum if private.', example: 25 })
  @IsNumber()
  @Min(0.01)
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

  @ApiPropertyOptional({
    description:
      'Where to send the buyer back once paid. Baked into the returned checkout URL as ?callback=, so it works regardless of how the link was opened (PayButton, a plain link, a QR code, pasted directly into a browser) — the checkout page appends ?payment=success&short_id=... and navigates there once the payment settles.',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  return_url?: string;
}
