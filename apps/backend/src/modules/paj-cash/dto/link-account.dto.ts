import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LinkAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  recipient: string; // email or E.164 phone number
}
