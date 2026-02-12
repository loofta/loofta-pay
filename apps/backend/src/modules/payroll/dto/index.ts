import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEmail, IsOptional, IsUUID, IsIn, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Organization DTOs
export class CreatePayrollOrganizationDto {
  @ApiProperty({ description: 'Organization name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Logo URL' })
  @IsOptional()
  @IsString()
  logoUrl?: string;
}

export class UpdatePayrollOrganizationDto {
  @ApiPropertyOptional({ description: 'Organization name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Logo URL' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'Address line 1', name: 'address_line1' })
  @IsOptional()
  @IsString()
  address_line1?: string;

  @ApiPropertyOptional({ description: 'Address line 2', name: 'address_line2' })
  @IsOptional()
  @IsString()
  address_line2?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'State / region' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ description: 'Postal code', name: 'postal_code' })
  @IsOptional()
  @IsString()
  postal_code?: string;

  @ApiPropertyOptional({ description: 'Country' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'Legal company name', name: 'company_legal_name' })
  @IsOptional()
  @IsString()
  company_legal_name?: string;

  @ApiPropertyOptional({ description: 'Company registration number', name: 'company_registration_number' })
  @IsOptional()
  @IsString()
  company_registration_number?: string;
}

// Contributor DTOs
export class CreateContributorDto {
  @ApiProperty({ description: 'Contributor email' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'First name' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ description: 'Wallet address' })
  @IsOptional()
  @IsString()
  walletAddress?: string;

  @ApiPropertyOptional({ description: 'Blockchain network (e.g., base, ethereum)' })
  @IsOptional()
  @IsString()
  network?: string;

  @ApiPropertyOptional({ description: 'Token symbol for payment (e.g., USDC, ETH)' })
  @IsOptional()
  @IsString()
  tokenSymbol?: string;

  @ApiPropertyOptional({ description: 'Department (e.g., marketing, finance, engineering)' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Contributor type', enum: ['internal_staff', 'contractor'] })
  @IsOptional()
  @IsIn(['internal_staff', 'contractor'])
  contributorType?: 'internal_staff' | 'contractor';
}

export class UpdateContributorDto {
  @ApiPropertyOptional({ description: 'First name' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ description: 'Wallet address' })
  @IsOptional()
  @IsString()
  walletAddress?: string;

  @ApiPropertyOptional({ description: 'Blockchain network' })
  @IsOptional()
  @IsString()
  network?: string;

  @ApiPropertyOptional({ description: 'Token symbol for payment' })
  @IsOptional()
  @IsString()
  tokenSymbol?: string;

  @ApiPropertyOptional({ description: 'Department (e.g., marketing, finance, engineering)' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Contributor type', enum: ['internal_staff', 'contractor'] })
  @IsOptional()
  @IsIn(['internal_staff', 'contractor'])
  contributorType?: 'internal_staff' | 'contractor';

  @ApiPropertyOptional({ description: 'Status', enum: ['invited', 'joined', 'removed'] })
  @IsOptional()
  @IsIn(['invited', 'joined', 'removed'])
  status?: 'invited' | 'joined' | 'removed';
}

/** Self-service update for contributor profile (name, address, business). API expects snake_case. */
export class UpdateContributorProfileDto {
  @ApiPropertyOptional({ description: 'First name', name: 'first_name' })
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional({ description: 'Last name', name: 'last_name' })
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional({ description: 'Address line 1', name: 'address_line1' })
  @IsOptional()
  @IsString()
  address_line1?: string;

  @ApiPropertyOptional({ description: 'Address line 2', name: 'address_line2' })
  @IsOptional()
  @IsString()
  address_line2?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'State / region' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ description: 'Postal code', name: 'postal_code' })
  @IsOptional()
  @IsString()
  postal_code?: string;

  @ApiPropertyOptional({ description: 'Country' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'Business name', name: 'business_name' })
  @IsOptional()
  @IsString()
  business_name?: string;

  @ApiPropertyOptional({ description: 'Business registration number', name: 'business_registration_number' })
  @IsOptional()
  @IsString()
  business_registration_number?: string;

  @ApiPropertyOptional({ description: 'Payout wallet address', name: 'wallet_address' })
  @IsOptional()
  @IsString()
  wallet_address?: string;

  @ApiPropertyOptional({ description: 'Payout network (e.g. base, ethereum)', name: 'network' })
  @IsOptional()
  @IsString()
  network?: string;

  @ApiPropertyOptional({ description: 'Payout token symbol (e.g. USDC)', name: 'token_symbol' })
  @IsOptional()
  @IsString()
  token_symbol?: string;
}

export class InviteContributorDto {
  @ApiProperty({ description: 'Contributor email' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'First name' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name' })
  @IsOptional()
  @IsString()
  lastName?: string;
}

// Response types
export interface PayrollOrganization {
  id: string;
  name: string;
  logo_url: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  company_legal_name?: string | null;
  company_registration_number?: string | null;
}

export interface PayrollContributor {
  id: string;
  organization_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  wallet_address: string | null;
  network: string | null;
  token_symbol: string | null;
  department: string | null;
  contributor_type: string | null;
  status: 'invited' | 'joined' | 'removed';
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  business_name?: string | null;
  business_registration_number?: string | null;
  kyc_status?: string | null;
  kyc_verified_at?: string | null;
}

export type ContributorStatus = 'invited' | 'joined' | 'removed';

export class OnboardContributorDto {
  @ApiProperty({ description: 'Wallet address to receive payments' })
  @IsString()
  walletAddress: string;

  @ApiProperty({ description: 'Blockchain network (e.g., base, ethereum)' })
  @IsString()
  network: string;

  @ApiProperty({ description: 'Token symbol (e.g., USDC, ETH)' })
  @IsString()
  tokenSymbol: string;

  @ApiPropertyOptional({ description: 'Loofta username for receiving payments' })
  @IsOptional()
  @IsString()
  username?: string;
}

// Payment run DTOs
export class CreatePayrollRunEntryDto {
  @ApiProperty({ description: 'Contributor UUID' })
  @IsUUID()
  contributorId: string;

  @ApiProperty({ description: 'Amount (human-readable, e.g. "100")' })
  @IsString()
  amount: string;
}

export class CreatePayrollRunDto {
  @ApiProperty({ description: 'Entries to pay', type: [CreatePayrollRunEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePayrollRunEntryDto)
  entries: CreatePayrollRunEntryDto[];

  @ApiProperty({ description: 'Token symbol (e.g., USDC)' })
  @IsString()
  tokenSymbol: string;

  @ApiProperty({ description: 'Network (e.g., solana, base)' })
  @IsString()
  network: string;
}

export interface PayrollRunEntryWithIntent {
  id: string;
  contributor_id: string;
  amount: string;
  token_symbol: string;
  network: string;
  recipient_address: string;
  status: string;
  deposit_address?: string | null;
  memo?: string | null;
  deadline?: string | null;
  created_at: string;
}

export interface PayrollRunResponse {
  id: string;
  organization_id: string;
  created_by: string;
  status: string;
  total_entries: number;
  completed_entries: number;
  created_at: string;
  updated_at: string;
  entries: PayrollRunEntryWithIntent[];
}
