import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type SendPaymentLinkStatus =
  | 'OPEN'
  | 'FUNDED'
  | 'CLAIMED'
  | 'CANCELLED'
  | 'EXPIRED';

export type RecipientType = 'email' | 'twitter';

export class SendPaymentLink {
  @ApiProperty({ description: 'Send payment link UUID' })
  id: string;

  @ApiProperty()
  created_at: string;

  @ApiPropertyOptional()
  updated_at: string | null;

  @ApiProperty({ description: 'Privy user ID of sender' })
  sender_user_id: string;

  @ApiProperty({ description: 'Amount (e.g. USD string)' })
  amount: string;

  @ApiProperty({ description: 'Token symbol', example: 'USDC' })
  token: string;

  @ApiProperty({ description: 'Chain', example: 'solana' })
  chain: string;

  @ApiProperty({ description: 'Recipient identifier type', enum: ['email', 'twitter'] })
  recipient_type: RecipientType;

  @ApiProperty({ description: 'Recipient identifier (email or Twitter handle)' })
  recipient_identifier: string;

  @ApiProperty({ description: 'Status', enum: ['OPEN', 'FUNDED', 'CLAIMED', 'CANCELLED', 'EXPIRED'] })
  status: SendPaymentLinkStatus;

  @ApiPropertyOptional({ description: 'Burner wallet address (public)' })
  burner_address?: string | null;

  @ApiPropertyOptional()
  deposit_tx_hash?: string | null;

  @ApiPropertyOptional()
  claim_tx_hash?: string | null;

  @ApiPropertyOptional({ description: 'Privy user ID of recipient (set when claimed)' })
  receiver_privy_user_id?: string | null;

  @ApiPropertyOptional()
  message?: string | null;

  @ApiPropertyOptional()
  expires_at?: string | null;
}

/** Public view: no recipient_identifier, no burner_encrypted_secret */
export class SendPaymentLinkPublic {
  @ApiProperty()
  id: string;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  token: string;

  @ApiProperty()
  chain: string;

  @ApiProperty({ enum: ['email', 'twitter'] })
  recipient_type: RecipientType;

  @ApiProperty({ enum: ['OPEN', 'FUNDED', 'CLAIMED', 'CANCELLED', 'EXPIRED'] })
  status: SendPaymentLinkStatus;

  @ApiPropertyOptional()
  message?: string | null;

  @ApiPropertyOptional()
  deposit_address?: string | null;

  @ApiPropertyOptional({ description: 'Burner wallet address (for SOL gas funding)' })
  burner_address?: string | null;

  @ApiPropertyOptional({ description: 'SOL lamports sender should send to burner for claim gas (e.g. 500000)' })
  required_sol_lamports?: number;
}
