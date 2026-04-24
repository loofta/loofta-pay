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
      payments: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          amount: string; // NUMERIC returned as string by PostgREST
          direction: PaymentDirection;
          recipient_address: string | null;
          recipient_username: string | null;
          recipient_email: string | null;
          burner_address: string | null;
          burner_encrypted_secret: string | null;
          status: PaymentStatus;
          paid_at: string | null;
          sender_tx_hash: string | null;
          sweep_tx_hash: string | null;
          description: string | null;
          paid_with_chain: string | null;
          is_devnet: boolean;
          legacy_claim_id: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          amount: number | string;
          direction?: PaymentDirection;
          recipient_address?: string | null;
          recipient_username?: string | null;
          recipient_email?: string | null;
          burner_address?: string | null;
          burner_encrypted_secret?: string | null;
          status?: PaymentStatus;
          paid_at?: string | null;
          sender_tx_hash?: string | null;
          sweep_tx_hash?: string | null;
          description?: string | null;
          paid_with_chain?: string | null;
          is_devnet?: boolean;
          legacy_claim_id?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          amount?: number | string;
          direction?: PaymentDirection;
          recipient_address?: string | null;
          recipient_username?: string | null;
          recipient_email?: string | null;
          burner_address?: string | null;
          burner_encrypted_secret?: string | null;
          status?: PaymentStatus;
          paid_at?: string | null;
          sender_tx_hash?: string | null;
          sweep_tx_hash?: string | null;
          description?: string | null;
          paid_with_chain?: string | null;
          is_devnet?: boolean;
          legacy_claim_id?: string | null;
        };
      };
      payment_intents: {
        Row: {
          id: string;
          payment_id: string;
          created_at: string;
          updated_at: string;
          quote_id: string | null;
          deposit_address: string | null;
          memo: string | null;
          deadline: string | null;
          time_estimate: number | null;
          status: string | null;
          from_chain: string | null;
          to_chain: string | null;
          paid_amount: string | null;
          last_status_payload: Json | null;
        };
        Insert: {
          id?: string;
          payment_id: string;
          created_at?: string;
          updated_at?: string;
          quote_id?: string | null;
          deposit_address?: string | null;
          memo?: string | null;
          deadline?: string | null;
          time_estimate?: number | null;
          status?: string | null;
          from_chain?: string | null;
          to_chain?: string | null;
          paid_amount?: string | null;
          last_status_payload?: Json | null;
        };
        Update: {
          id?: string;
          payment_id?: string;
          created_at?: string;
          updated_at?: string;
          quote_id?: string | null;
          deposit_address?: string | null;
          memo?: string | null;
          deadline?: string | null;
          time_estimate?: number | null;
          status?: string | null;
          from_chain?: string | null;
          to_chain?: string | null;
          paid_amount?: string | null;
          last_status_payload?: Json | null;
        };
      };
      payment_events: {
        Row: {
          id: number;
          payment_id: string;
          created_at: string;
          type: string;
          payload: Json | null;
        };
        Insert: {
          id?: number;
          payment_id: string;
          created_at?: string;
          type: string;
          payload?: Json | null;
        };
        Update: {
          id?: number;
          payment_id?: string;
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

export type PaymentStatus =
  | 'OPEN'
  | 'PENDING_DEPOSIT'
  | 'IN_FLIGHT'
  | 'FUNDED'
  | 'PRIVATE_TRANSFER_PENDING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'DELETED';

export type PaymentDirection = 'from_sender' | 'from_recipient';

export type CheckoutStatus = 'active' | 'inactive' | 'pending';

export type UserRole = 'user' | 'admin' | 'super_admin';

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

export type Payment = Tables<'payments'>;
export type PaymentInsert = InsertTables<'payments'>;
export type PaymentUpdate = UpdateTables<'payments'>;

export type PaymentIntent = Tables<'payment_intents'>;
export type PaymentIntentInsert = InsertTables<'payment_intents'>;
export type PaymentIntentUpdate = UpdateTables<'payment_intents'>;

export type Organization = Tables<'organizations'>;
export type OrganizationInsert = InsertTables<'organizations'>;
export type OrganizationUpdate = UpdateTables<'organizations'>;

export type User = Tables<'users'>;
export type UserInsert = InsertTables<'users'>;
export type UserUpdate = UpdateTables<'users'>;

