import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReviewLinkAuthDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  password: string;
}
