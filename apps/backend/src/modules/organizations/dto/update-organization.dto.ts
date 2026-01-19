import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty } from 'class-validator';
import { CreateOrganizationDto } from './create-organization.dto';

export class UpdateOrganizationDto extends PartialType(
  OmitType(CreateOrganizationDto, ['organization_id'] as const),
) {
  @ApiProperty({ description: 'Database ID of the organization' })
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: 'Organization identifier (can be updated)' })
  organization_id?: string;
}
