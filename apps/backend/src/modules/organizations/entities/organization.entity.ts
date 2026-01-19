import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Matches database constraint for checkout_status
export type CheckoutStatus = 'active' | 'inactive' | 'pending';

export class Organization {
  @ApiProperty({ description: 'Database UUID' })
  id: string;

  @ApiProperty({ description: 'Unique organization identifier' })
  organization_id: string;

  @ApiProperty({ description: 'Organization display name' })
  name: string;

  @ApiPropertyOptional({ description: 'URL to organization logo' })
  logo_url: string | null;

  @ApiProperty({ description: 'Checkout status', enum: ['active', 'inactive', 'pending'] })
  checkout_status: CheckoutStatus;

  @ApiProperty({ description: 'Auto-generated referral code' })
  org_referral: string;

  @ApiPropertyOptional({ description: 'Recipient wallet address' })
  recipient_wallet: string | null;

  @ApiPropertyOptional({ description: 'Token symbol for payments' })
  token_symbol: string | null;

  @ApiPropertyOptional({ description: 'Chain for token payments' })
  token_chain: string | null;

  @ApiPropertyOptional({ description: 'Background color for branding' })
  bg_color: string | null;

  @ApiPropertyOptional({ description: 'Payment configuration' })
  payment_config: Record<string, unknown> | null;

  @ApiProperty({ description: 'Creation timestamp' })
  created_at: string;

  @ApiPropertyOptional({ description: 'Last update timestamp' })
  updated_at: string | null;
}
