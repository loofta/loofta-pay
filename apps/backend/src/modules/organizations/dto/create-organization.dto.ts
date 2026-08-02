import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNotEmpty, IsEmail, IsUrl, MaxLength } from 'class-validator';

export enum CheckoutStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
}

export class CreateOrganizationDto {
  @ApiProperty({ description: 'Unique organization identifier', example: 'acme-corp' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  organization_id: string;

  @ApiProperty({ description: 'Organization display name', example: 'Acme Corporation' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: 'URL to organization logo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logo_url?: string;

  @ApiPropertyOptional({ enum: CheckoutStatus, default: CheckoutStatus.INACTIVE })
  @IsOptional()
  @IsEnum(CheckoutStatus)
  checkout_status?: CheckoutStatus;

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

  @ApiPropertyOptional({ description: 'Chain for token payments', example: 'base' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  token_chain?: string;

  @ApiPropertyOptional({ description: 'Background color for branding', example: '#1a1a1a' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  bg_color?: string;

  @ApiPropertyOptional({ description: 'Business contact email — required for self-serve signup, used for approval/support contact' })
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
