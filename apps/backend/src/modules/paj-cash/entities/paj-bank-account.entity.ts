export interface PajCashBankAccountRow {
  id: string;
  user_id: string;
  paj_bank_account_id: string;
  bank_id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  wallet_address: string | null;
  is_default: boolean;
  created_at: string;
}
