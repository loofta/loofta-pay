import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ConfirmSentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  txSignature: string;
}
