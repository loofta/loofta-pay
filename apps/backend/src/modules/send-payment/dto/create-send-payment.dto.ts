import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, IsIn, MaxLength } from 'class-validator';

export class CreateSendPaymentDto {
  @ApiProperty({ description: 'Amount in USD', example: 50 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Recipient type', enum: ['email', 'twitter'] })
  @IsString()
  @IsIn(['email', 'twitter'])
  recipient_type: 'email' | 'twitter';

  @ApiProperty({
    description: 'Recipient identifier: email address or Twitter handle (with or without @)',
    example: 'alice@example.com or alice_xyz',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  recipient_identifier: string;

  @ApiPropertyOptional({ description: 'Message for recipient' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
