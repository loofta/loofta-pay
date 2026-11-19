import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreatePartnerDto {
  @ApiProperty({ example: 'Clipur' })
  @IsString()
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  logo_url?: string;
}

export class UpdatePartnerDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  // null removes the logo.
  @IsOptional() @IsUrl({ require_tld: false }) logo_url?: string | null;
  @IsOptional() @IsString() @MaxLength(20) brand_color?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(120) legal_name?: string;
  @IsOptional() @IsString() @MaxLength(2) country?: string;
  @IsOptional() @IsUrl({ require_tld: false }) website?: string;
  @IsOptional() @IsEmail() contact_email?: string;
  @IsOptional() @IsUrl({ require_tld: false }) recipients_pull_url?: string;
}

export class UpdatePartnerSettingsDto {
  @ApiPropertyOptional({ description: 'Smallest amount a recipient can withdraw, USD' })
  @IsOptional() @IsNumber() @Min(0) @Max(10000) withdraw_min_usd?: number;
  @ApiPropertyOptional({ description: 'Flat fee per withdrawal, USD. Added on top of Loofta\'s fee.' })
  @IsOptional() @IsNumber() @Min(0) @Max(25) fee_fixed_usd?: number;
  @ApiPropertyOptional({ description: 'Percent fee in basis points (100 = 1%). Added on top of Loofta\'s fee.' })
  @IsOptional() @IsInt() @Min(0) @Max(1000) fee_percent_bps?: number;
  @ApiPropertyOptional({ description: 'Solana wallet that receives your fees. Owner only. A change takes effect after 24 hours.' })
  @IsOptional() @IsString() @MaxLength(64) fee_wallet?: string;
  @ApiPropertyOptional({ description: 'Batches above this many USD need a second member to approve. Owner only.' })
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) approval_threshold_usd?: number;
}

export class RecipientInputDto {
  @IsOptional() @IsString() @MaxLength(200) external_user_id?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsIn(['twitter', 'discord', 'github', 'telegram']) handle_platform?: 'twitter' | 'discord' | 'github' | 'telegram';
  @IsOptional() @IsString() @MaxLength(100) handle?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class ImportRecipientsDto {
  @ApiProperty({ type: [RecipientInputDto], description: 'Up to 1000 recipients. Each needs an email or a handle.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => RecipientInputDto)
  recipients: RecipientInputDto[];
}

export class InviteMemberDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsIn(['admin', 'payer', 'viewer', 'owner']) role: 'owner' | 'admin' | 'payer' | 'viewer';
}

export class ChangeRoleDto {
  @IsIn(['admin', 'payer', 'viewer', 'owner']) role: 'owner' | 'admin' | 'payer' | 'viewer';
}

export class AcceptInviteDto {
  @IsString() @MaxLength(200) token: string;
}

export class SetApiAccessDto {
  @ApiProperty({ description: 'Let this partner\'s API keys draft payout batches. They are still approved and funded by your team.' })
  @IsBoolean()
  payout_batches: boolean;
}

export class SetWebhookDto {
  @ApiProperty({ description: 'An https URL that receives signed payout and batch events, or null to turn webhooks off.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url: string | null;
}
