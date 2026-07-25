import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SaveBankAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bankId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bankName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  accountNumber: string;
}
