import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Re-export ClaimStatus from the constraint check in database
// Matches: check (status in ('OPEN','PENDING_DEPOSIT','IN_FLIGHT','PRIVATE_TRANSFER_PENDING','SUCCESS','REFUNDED','EXPIRED','CANCELLED'))
export type ClaimStatus = 
  | 'OPEN'
  | 'PENDING_DEPOSIT'
  | 'IN_FLIGHT'
  | 'PRIVATE_TRANSFER_PENDING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'CANCELLED';

export class Claim {
  @ApiProperty({ description: 'Claim UUID' })
  id: string;

  @ApiProperty({ description: 'Amount in USD' })
  amount: string;

  @ApiProperty({ description: 'Destination token symbol' })
  to_symbol: string;

  @ApiProperty({ description: 'Destination chain' })
  to_chain: string;

  @ApiProperty({ description: 'Recipient wallet address' })
  recipient_address: string;

  @ApiPropertyOptional({ description: 'Privy user ID who created the claim' })
  created_by: string | null;

  @ApiPropertyOptional({ description: 'Creator email (legacy)' })
  creator_email: string | null;

  @ApiPropertyOptional({ description: 'Creator username resolved from created_by (privy ID); for display use @username or Anonymous' })
  creator_username?: string | null;

  @ApiPropertyOptional({ description: 'Payment description/message (supports emojis and GIFs)' })
  description: string | null;

  @ApiProperty({ 
    description: 'Claim status', 
    enum: ['OPEN', 'PENDING_DEPOSIT', 'IN_FLIGHT', 'PRIVATE_TRANSFER_PENDING', 'SUCCESS', 'REFUNDED', 'EXPIRED', 'CANCELLED'] 
  })
  status: ClaimStatus;

  @ApiPropertyOptional({ description: 'Whether this is a private payment using Privacy Cash' })
  is_private: boolean | null;

  @ApiPropertyOptional({ description: 'Timestamp when payment was completed' })
  paid_at: string | null;

  @ApiProperty({ description: 'Creation timestamp' })
  created_at: string;

  @ApiPropertyOptional({ description: 'Last update timestamp' })
  updated_at: string | null;
}

export class ClaimIntent {
  @ApiProperty({ description: 'Intent UUID' })
  id: string;

  @ApiProperty({ description: 'Associated claim ID' })
  claim_id: string;

  @ApiPropertyOptional({ description: 'Quote ID from 1Click' })
  quote_id: string | null;

  @ApiPropertyOptional({ description: 'Deposit address for payment' })
  deposit_address: string | null;

  @ApiPropertyOptional({ description: 'Memo for deposit (if required)' })
  memo: string | null;

  @ApiPropertyOptional({ description: 'Deadline for deposit' })
  deadline: string | null;

  @ApiPropertyOptional({ description: 'Estimated time in seconds' })
  time_estimate: number | null;

  @ApiProperty({ description: 'Intent status' })
  status: string;

  @ApiPropertyOptional({ description: 'Source chain' })
  from_chain: string | null;

  @ApiPropertyOptional({ description: 'Destination chain' })
  to_chain: string | null;

  @ApiPropertyOptional({ description: 'Amount paid (in atomic units)' })
  paid_amount: string | null;

  @ApiPropertyOptional({ description: 'Last status payload from provider' })
  last_status_payload: any;

  @ApiProperty({ description: 'Creation timestamp' })
  created_at: string;
}
