export type PajKycStatus = 'unknown' | 'not_required' | 'pending' | 'verified' | 'rejected';

export interface PajCashSessionRow {
  id: string;
  user_id: string;
  recipient: string;
  recipient_type: 'email' | 'phone';
  session_token_enc: string;
  expires_at: string;
  kyc_status: PajKycStatus;
  kyc_id_type: 'BVN' | 'NIN' | null;
  created_at: string;
  updated_at: string;
}
