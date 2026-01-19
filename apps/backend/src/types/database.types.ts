/**
 * Supabase Database Types
 * 
 * To regenerate these types from your database, run:
 *   npm run db:types
 * 
 * Or for local Supabase:
 *   npm run db:types:local
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ===========================================
// Enum Types - Matches database constraints
// ===========================================

export type ClaimStatus =
  | 'OPEN'
  | 'PENDING_DEPOSIT'
  | 'IN_FLIGHT'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'CANCELLED';

export type CheckoutStatus = 'active' | 'inactive' | 'pending';

export type UserRole = 'user' | 'admin' | 'super_admin';

export type PayrollStatus = 'draft' | 'pending' | 'processing' | 'completed' | 'failed';

// ===========================================
// Table Types
// ===========================================

export interface AppUser {
  id: string;
  created_at: string;
  privy_user_id: string | null;
  email: string | null;
  notify_email: boolean;
}

export interface Claim {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  creator_email: string | null;
  amount: string;
  to_symbol: string;
  to_chain: string;
  recipient_address: string;
  notify_email_to: string | null;
  status: ClaimStatus;
  paid_at: string | null;
  org_referral: string | null;
}

export interface ClaimInsert {
  id?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  creator_email?: string | null;
  amount: string;
  to_symbol: string;
  to_chain: string;
  recipient_address: string;
  notify_email_to?: string | null;
  status?: ClaimStatus;
  paid_at?: string | null;
  org_referral?: string | null;
}

export interface ClaimUpdate {
  id?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  creator_email?: string | null;
  amount?: string;
  to_symbol?: string;
  to_chain?: string;
  recipient_address?: string;
  notify_email_to?: string | null;
  status?: ClaimStatus;
  paid_at?: string | null;
  org_referral?: string | null;
}

export interface ClaimIntent {
  id: string;
  claim_id: string;
  created_at: string;
  updated_at: string;
  quote_id: string | null;
  deposit_address: string | null;
  memo: string | null;
  deadline: string | null;
  time_estimate: number | null;
  status: string | null;
  last_status_payload: Json | null;
  paid_amount: string | null;
  from_symbol: string | null;
  from_chain: string | null;
  companion_address: string | null;
}

export interface ClaimIntentInsert {
  id?: string;
  claim_id: string;
  created_at?: string;
  updated_at?: string;
  quote_id?: string | null;
  deposit_address?: string | null;
  memo?: string | null;
  deadline?: string | null;
  time_estimate?: number | null;
  status?: string | null;
  last_status_payload?: Json | null;
  paid_amount?: string | null;
  from_symbol?: string | null;
  from_chain?: string | null;
  companion_address?: string | null;
}

export interface ClaimIntentUpdate {
  id?: string;
  claim_id?: string;
  created_at?: string;
  updated_at?: string;
  quote_id?: string | null;
  deposit_address?: string | null;
  memo?: string | null;
  deadline?: string | null;
  time_estimate?: number | null;
  status?: string | null;
  last_status_payload?: Json | null;
  paid_amount?: string | null;
  from_symbol?: string | null;
  from_chain?: string | null;
  companion_address?: string | null;
}

export interface ClaimEvent {
  id: number;
  claim_id: string;
  created_at: string;
  type: string;
  payload: Json | null;
}

export interface Organization {
  id: string;
  organization_id: string;
  name: string;
  logo_url: string | null;
  checkout_status: CheckoutStatus;
  org_referral: string;
  recipient_wallet: string | null;
  token_symbol: string | null;
  token_chain: string | null;
  bg_color: string | null;
  payment_config: Json | null;
  created_at: string;
  updated_at: string | null;
}

export interface OrganizationInsert {
  id?: string;
  organization_id: string;
  name: string;
  logo_url?: string | null;
  checkout_status?: CheckoutStatus;
  org_referral: string;
  recipient_wallet?: string | null;
  token_symbol?: string | null;
  token_chain?: string | null;
  bg_color?: string | null;
  payment_config?: Json | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface OrganizationUpdate {
  id?: string;
  organization_id?: string;
  name?: string;
  logo_url?: string | null;
  checkout_status?: CheckoutStatus;
  org_referral?: string;
  recipient_wallet?: string | null;
  token_symbol?: string | null;
  token_chain?: string | null;
  bg_color?: string | null;
  payment_config?: Json | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface User {
  id: string;
  privy_user_id: string;
  email: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string | null;
}

export interface UserInsert {
  id?: string;
  privy_user_id: string;
  email?: string | null;
  role?: UserRole;
  created_at?: string;
  updated_at?: string | null;
}

export interface UserUpdate {
  id?: string;
  privy_user_id?: string;
  email?: string | null;
  role?: UserRole;
  created_at?: string;
  updated_at?: string | null;
}

export interface PayrollBatch {
  id: string;
  org_id: string;
  name: string | null;
  total_amount: string;
  token_symbol: string;
  token_chain: string;
  status: PayrollStatus;
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

export interface PayrollRecipient {
  id: string;
  batch_id: string;
  email: string | null;
  wallet_address: string;
  amount: string;
  claim_id: string | null;
  status: string;
  created_at: string;
}

// ===========================================
// Database Schema Type
// ===========================================

export type Database = {
  public: {
    Tables: {
      app_users: {
        Row: AppUser;
        Insert: Partial<AppUser> & Pick<AppUser, never>;
        Update: Partial<AppUser>;
      };
      claims: {
        Row: Claim;
        Insert: ClaimInsert;
        Update: ClaimUpdate;
      };
      claim_intents: {
        Row: ClaimIntent;
        Insert: ClaimIntentInsert;
        Update: ClaimIntentUpdate;
      };
      claim_events: {
        Row: ClaimEvent;
        Insert: Omit<ClaimEvent, 'id'>;
        Update: Partial<ClaimEvent>;
      };
      organizations: {
        Row: Organization;
        Insert: OrganizationInsert;
        Update: OrganizationUpdate;
      };
      users: {
        Row: User;
        Insert: UserInsert;
        Update: UserUpdate;
      };
      payroll_batches: {
        Row: PayrollBatch;
        Insert: Omit<PayrollBatch, 'id' | 'created_at' | 'updated_at'> & { id?: string };
        Update: Partial<PayrollBatch>;
      };
      payroll_recipients: {
        Row: PayrollRecipient;
        Insert: Omit<PayrollRecipient, 'id' | 'created_at'> & { id?: string };
        Update: Partial<PayrollRecipient>;
      };
    };
    Views: {
      public_claims: {
        Row: Pick<Claim, 'id' | 'created_at' | 'amount' | 'to_symbol' | 'to_chain' | 'status'>;
      };
    };
    Enums: {
      claim_status: ClaimStatus;
      checkout_status: CheckoutStatus;
      user_role: UserRole;
      payroll_status: PayrollStatus;
    };
  };
};
