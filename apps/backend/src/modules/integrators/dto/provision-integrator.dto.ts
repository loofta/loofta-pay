import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEmail, IsBoolean, IsInt, Min, Max, MaxLength } from 'class-validator';

export class ProvisionIntegratorDto {
  @ApiProperty({ description: 'Human-readable integrator name', example: 'Acme Agent Framework' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: 'Contact email for this integrator' })
  @IsOptional()
  @IsEmail()
  contact_email?: string;

  @ApiPropertyOptional({ description: 'Defaults to true — mainnet is an explicit grant', default: true })
  @IsOptional()
  @IsBoolean()
  is_devnet_only?: boolean;

  @ApiPropertyOptional({ description: 'Requests allowed per minute', default: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6000)
  rate_limit_per_min?: number;
}
