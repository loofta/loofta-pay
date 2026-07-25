export type PajOrderDirection = 'ON_RAMP' | 'OFF_RAMP';

export type PajOrderStatus =
  | 'CREATED'
  | 'AWAITING_PAYMENT'
  | 'USDC_SENT'
  | 'PAJ_PAID'
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface PajCashOrderRow {
  id: string;
  user_id: string;
  direction: PajOrderDirection;
  paj_order_id: string | null;
  currency: string;
  fiat_amount: number | null;
  amount_usdc: number | null;
  rate: number | null;
  fee_usdc: number | null;
  onramp_bank_name: string | null;
  onramp_account_number: string | null;
  onramp_account_name: string | null;
  offramp_deposit_address: string | null;
  offramp_bank_account_id: string | null;
  offramp_tx_signature: string | null;
  status: PajOrderStatus;
  last_reconciled_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
