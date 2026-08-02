import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, IsUrl, MaxLength } from 'class-validator';

/**
 * Self-serve org settings update — deliberately narrower than UpdateOrganizationDto: no
 * checkout_status (activation is admin-only, see OrganizationsController.updateStatus below)
 * and no organization_id (renaming the slug would break already-issued checkout/PayButton links).
 */
export class UpdateOrganizationSelfServeDto {
  @ApiPropertyOptional({ description: 'Organization display name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'URL to organization logo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logo_url?: string;

  @ApiPropertyOptional({ description: 'Recipient wallet address for payments' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  recipient_wallet?: string;

  @ApiPropertyOptional({ description: 'Token symbol for payments', example: 'USDC' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  token_symbol?: string;

  @ApiPropertyOptional({ description: 'Chain for token payments', example: 'solana' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  token_chain?: string;

  @ApiPropertyOptional({ description: 'Background color for branding', example: '#1a1a1a' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  bg_color?: string;

  @ApiPropertyOptional({ description: 'Business contact email' })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  contact_email?: string;

  @ApiPropertyOptional({ description: 'Website or app where checkout will be embedded/linked' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  website_url?: string;
}
