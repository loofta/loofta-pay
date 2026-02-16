import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEmail,
  IsBoolean,
  MaxLength,
} from 'class-validator';

// ---- Deals ----
export class CreateDealDto {
  @ApiProperty({ description: 'Deal title' })
  @IsString()
  @MaxLength(500)
  title: string;

  @ApiPropertyOptional({ description: 'Deal description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Instructions for the freelancer' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiProperty({ description: 'Amount (human-readable)' })
  @IsString()
  amount: string;

  @ApiPropertyOptional({ description: 'Currency for the amount', default: 'USD' })
  @IsOptional()
  @IsString()
  amount_currency?: string;

  @ApiPropertyOptional({ description: 'Deal deadline (ISO date)' })
  @IsOptional()
  @IsString()
  deadline?: string;
}

export class UpdateDealDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  amount_currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deadline?: string;
}

export interface DealResponse {
  id: string;
  organization_id: string;
  created_by: string;
  title: string;
  description: string | null;
  instructions: string | null;
  contract_attachment_path: string | null;
  contract_attachment_url?: string | null;
  amount: string;
  amount_currency: string;
  status: string;
  deadline: string | null;
  delivery_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  invites?: DealInviteResponse[];
}

// ---- Deal invites ----
export class CreateDealInviteDto {
  @ApiProperty({ description: 'Freelancer email to invite' })
  @IsEmail()
  invitee_email: string;
}

export class AcceptDealInviteDto {
  @ApiPropertyOptional({ description: 'Preferred payout network (e.g. base, arbitrum)' })
  @IsOptional()
  @IsString()
  preferred_network?: string;

  @ApiPropertyOptional({ description: 'Preferred token (e.g. USDC, ETH)' })
  @IsOptional()
  @IsString()
  preferred_token_symbol?: string;
}

export class RequestChangesDealInviteDto {
  @ApiProperty({ description: 'Message describing requested term changes' })
  @IsString()
  message: string;
}

export interface DealInviteResponse {
  id: string;
  deal_id: string;
  freelancer_profile_id: string | null;
  invitee_email: string;
  status: string;
  request_changes_message: string | null;
  preferred_network: string | null;
  preferred_token_symbol: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealPaymentResponse {
  id: string;
  deal_id: string;
  deal_invite_id: string;
  organization_id: string;
  amount: string;
  amount_currency: string;
  recipient_wallet: string;
  recipient_email?: string | null;
  preferred_network: string;
  preferred_token_symbol: string;
  status: string;
  deposit_address: string | null;
  intent_deadline: string | null;
  tx_hash: string | null;
  created_at: string;
  updated_at: string;
  /** From preparePay quote (same $→token as c/[id]) */
  minAmountInFormatted?: string;
  timeEstimate?: number;
  memo?: string | null;
  /** Linked invoice id (for list view link) */
  invoice_id?: string;
  /** When payment is completed, invoice receipt on-chain (from linked invoice) */
  receipt_on_chain_tx_hash?: string | null;
}

export interface DealInvoiceResponse {
  id: string;
  deal_id: string;
  deal_payment_id: string | null;
  organization_id: string;
  amount: string;
  amount_currency: string;
  recipient_email: string | null;
  status: string;
  created_at: string;
  invoice_number?: string | null;
  /** NEAR tx hash when receipt was recorded on-chain (paid invoices) */
  receipt_on_chain_tx_hash?: string | null;
}

export interface InvoiceFromFreelancer {
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
  billing_address?: string | null;
  tva_number?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  business_name?: string | null;
  business_registration_number?: string | null;
}

export interface InvoiceToOrg {
  name: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  company_legal_name?: string | null;
  company_registration_number?: string | null;
}

// ---- Deal comments ----
export class CreateDealCommentDto {
  @ApiProperty({ description: 'Comment text' })
  @IsString()
  @MaxLength(2000)
  body: string;
}

export interface DealCommentResponse {
  id: string;
  deal_id: string;
  author_user_id: string;
  author_display: string;
  body: string;
  created_at: string;
}

// ---- Freelancer profile (invoicing, KYC, verify) ----
export class CreateFreelancerProfileDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  wallet_address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  preferred_network?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  preferred_token_symbol?: string;

  @ApiPropertyOptional({ description: 'Billing address for invoicing' })
  @IsOptional()
  @IsString()
  billing_address?: string;

  @ApiPropertyOptional({ description: 'VAT / TVA number' })
  @IsOptional()
  @IsString()
  tva_number?: string;

  @ApiPropertyOptional({ description: 'Verification service name' })
  @IsOptional()
  @IsString()
  verify_service?: string;

  @ApiPropertyOptional({ description: 'Whether KYC is required for this freelancer' })
  @IsOptional()
  @IsBoolean()
  kyc_required?: boolean;
}

export class UpdateFreelancerProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  wallet_address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  preferred_network?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  preferred_token_symbol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billing_address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tva_number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verify_service?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  kyc_required?: boolean;
}

export interface FreelancerProfileResponse {
  id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  wallet_address: string | null;
  preferred_network: string | null;
  preferred_token_symbol: string | null;
  billing_address: string | null;
  tva_number: string | null;
  verify_service: string | null;
  verify_status: string;
  kyc_required: boolean;
  kyc_status: string;
  created_at: string;
  updated_at: string;
}
