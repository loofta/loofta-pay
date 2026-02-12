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

  @ApiPropertyOptional({ description: 'Status', enum: ['invited', 'joined', 'removed'] })
  @IsOptional()
  @IsIn(['invited', 'joined', 'removed'])
  status?: 'invited' | 'joined' | 'removed';
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
  status: 'invited' | 'joined' | 'removed';
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string | null;
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
