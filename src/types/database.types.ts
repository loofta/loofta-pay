/**
 * Supabase Database Types
 * 
 * To regenerate these types from your database, run:
 *   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.types.ts
 * 
 * Or if running Supabase locally:
 *   npx supabase gen types typescript --local > src/types/database.types.ts
 * 
 * Prerequisites:
 *   npm install -g supabase (or npx supabase)
 *   supabase login
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      app_users: {
        Row: {
          id: string;
          created_at: string;
          privy_user_id: string | null;
          email: string | null;
          notify_email: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          privy_user_id?: string | null;
          email?: string | null;
          notify_email?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          privy_user_id?: string | null;
          email?: string | null;
          notify_email?: boolean;
        };
      };
      claims: {
        Row: {
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
        };
        Insert: {
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
        };
        Update: {
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
        };
      };
      claim_intents: {
        Row: {
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
        };
        Insert: {
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
        };
        Update: {
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
        };
      };
      claim_events: {
        Row: {
          id: number;
          claim_id: string;
          created_at: string;
          type: string;
          payload: Json | null;
        };
        Insert: {
          id?: number;
          claim_id: string;
          created_at?: string;
          type: string;
          payload?: Json | null;
        };
        Update: {
          id?: number;
          claim_id?: string;
          created_at?: string;
          type?: string;
          payload?: Json | null;
        };
      };
      organizations: {
        Row: {
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
        };
        Insert: {
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
        };
        Update: {
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
        };
      };
      users: {
        Row: {
          id: string;
          privy_user_id: string;
          email: string | null;
          role: UserRole;
          created_at: string;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          privy_user_id: string;
          email?: string | null;
          role?: UserRole;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          privy_user_id?: string;
          email?: string | null;
          role?: UserRole;
          created_at?: string;
          updated_at?: string | null;
        };
      };
      payroll_batches: {
        Row: {
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
        };
        Insert: {
          id?: string;
          org_id: string;
          name?: string | null;
          total_amount: string;
          token_symbol: string;
          token_chain: string;
          status?: PayrollStatus;
          created_by: string;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string | null;
          total_amount?: string;
          token_symbol?: string;
          token_chain?: string;
          status?: PayrollStatus;
          created_by?: string;
          created_at?: string;
          updated_at?: string | null;
        };
      };
      payroll_recipients: {
        Row: {
          id: string;
          batch_id: string;
          email: string | null;
          wallet_address: string;
          amount: string;
          claim_id: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          batch_id: string;
          email?: string | null;
          wallet_address: string;
          amount: string;
          claim_id?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          batch_id?: string;
          email?: string | null;
          wallet_address?: string;
          amount?: string;
          claim_id?: string | null;
          status?: string;
          created_at?: string;
        };
      };
    };
    Views: {
      public_claims: {
        Row: {
          id: string;
          created_at: string;
          amount: string;
          to_symbol: string;
          to_chain: string;
          status: ClaimStatus;
        };
      };
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      claim_status: ClaimStatus;
      checkout_status: CheckoutStatus;
      user_role: UserRole;
      payroll_status: PayrollStatus;
    };
  };
};

// Enum types for better type safety
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

// Helper types for easier usage
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type InsertTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type UpdateTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

// Commonly used table types
export type Claim = Tables<'claims'>;
export type ClaimInsert = InsertTables<'claims'>;
export type ClaimUpdate = UpdateTables<'claims'>;

export type ClaimIntent = Tables<'claim_intents'>;
export type ClaimIntentInsert = InsertTables<'claim_intents'>;
export type ClaimIntentUpdate = UpdateTables<'claim_intents'>;

export type Organization = Tables<'organizations'>;
export type OrganizationInsert = InsertTables<'organizations'>;
export type OrganizationUpdate = UpdateTables<'organizations'>;

export type User = Tables<'users'>;
export type UserInsert = InsertTables<'users'>;
export type UserUpdate = UpdateTables<'users'>;

export type PayrollBatch = Tables<'payroll_batches'>;
export type PayrollRecipient = Tables<'payroll_recipients'>;
