export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          operationName?: string
          extensions?: Json
          variables?: Json
          query?: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_users: {
        Row: {
          created_at: string
          email: string | null
          id: string
          notify_email: boolean
          privy_user_id: string | null
          username: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          notify_email?: boolean
          privy_user_id?: string | null
          username?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          notify_email?: boolean
          privy_user_id?: string | null
          username?: string | null
        }
        Relationships: []
      }
      claim_events: {
        Row: {
          claim_id: string
          created_at: string
          id: number
          payload: Json | null
          type: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          id?: number
          payload?: Json | null
          type: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          id?: number
          payload?: Json | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_events_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_events_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "public_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_intents: {
        Row: {
          claim_id: string
          created_at: string
          deadline: string | null
          deposit_address: string | null
          id: string
          last_status_payload: Json | null
          memo: string | null
          paid_amount: string | null
          quote_id: string | null
          status: string | null
          time_estimate: number | null
          updated_at: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          deadline?: string | null
          deposit_address?: string | null
          id?: string
          last_status_payload?: Json | null
          memo?: string | null
          paid_amount?: string | null
          quote_id?: string | null
          status?: string | null
          time_estimate?: number | null
          updated_at?: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          deadline?: string | null
          deposit_address?: string | null
          id?: string
          last_status_payload?: Json | null
          memo?: string | null
          paid_amount?: string | null
          quote_id?: string | null
          status?: string | null
          time_estimate?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_intents_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_intents_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "public_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      claims: {
        Row: {
          amount: string
          created_at: string
          created_by: string | null
          creator_email: string | null
          id: string
          notify_email_to: string | null
          paid_at: string | null
          recipient_address: string
          status: string
          to_chain: string
          to_symbol: string
          updated_at: string
        }
        Insert: {
          amount: string
          created_at?: string
          created_by?: string | null
          creator_email?: string | null
          id?: string
          notify_email_to?: string | null
          paid_at?: string | null
          recipient_address: string
          status?: string
          to_chain: string
          to_symbol: string
          updated_at?: string
        }
        Update: {
          amount?: string
          created_at?: string
          created_by?: string | null
          creator_email?: string | null
          id?: string
          notify_email_to?: string | null
          paid_at?: string | null
          recipient_address?: string
          status?: string
          to_chain?: string
          to_symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      confidential_payments: {
        Row: {
          completed_at: string | null
          created_at: string | null
          employee_address: string
          encrypted_amount: string
          id: string
          payroll_batch_id: string | null
          status: string
          token_address: string
          tx_signature: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          employee_address: string
          encrypted_amount: string
          id?: string
          payroll_batch_id?: string | null
          status?: string
          token_address: string
          tx_signature?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          employee_address?: string
          encrypted_amount?: string
          id?: string
          payroll_batch_id?: string | null
          status?: string
          token_address?: string
          tx_signature?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "confidential_payments_payroll_batch_id_fkey"
            columns: ["payroll_batch_id"]
            isOneToOne: false
            referencedRelation: "payroll_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          bg_color: string | null
          checkout_status: string
          created_at: string
          created_by: string | null
          id: string
          logo_url: string | null
          name: string
          org_referral: string
          organization_id: string
          recipient_wallet: string | null
          token_chain: string | null
          token_symbol: string | null
          updated_at: string
        }
        Insert: {
          bg_color?: string | null
          checkout_status?: string
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name: string
          org_referral: string
          organization_id: string
          recipient_wallet?: string | null
          token_chain?: string | null
          token_symbol?: string | null
          updated_at?: string
        }
        Update: {
          bg_color?: string | null
          checkout_status?: string
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          org_referral?: string
          organization_id?: string
          recipient_wallet?: string | null
          token_chain?: string | null
          token_symbol?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payroll_batches: {
        Row: {
          batch_id: string
          company_wallet: string
          created_at: string | null
          created_by: string | null
          employee_count: number
          encrypted_batch: string
          executed_at: string | null
          id: string
          scheduled_date: string | null
          status: string
          tx_signatures: string[] | null
          updated_at: string | null
        }
        Insert: {
          batch_id: string
          company_wallet: string
          created_at?: string | null
          created_by?: string | null
          employee_count: number
          encrypted_batch: string
          executed_at?: string | null
          id?: string
          scheduled_date?: string | null
          status?: string
          tx_signatures?: string[] | null
          updated_at?: string | null
        }
        Update: {
          batch_id?: string
          company_wallet?: string
          created_at?: string | null
          created_by?: string | null
          employee_count?: number
          encrypted_batch?: string
          executed_at?: string | null
          id?: string
          scheduled_date?: string | null
          status?: string
          tx_signatures?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payroll_contributors: {
        Row: {
          created_at: string | null
          department: string | null
          email: string
          first_name: string | null
          id: string
          invited_at: string | null
          joined_at: string | null
          last_name: string | null
          network: string | null
          organization_id: string
          status: string
          token_symbol: string | null
          updated_at: string | null
          wallet_address: string | null
        }
        Insert: {
          created_at?: string | null
          department?: string | null
          email: string
          first_name?: string | null
          id?: string
          invited_at?: string | null
          joined_at?: string | null
          last_name?: string | null
          network?: string | null
          organization_id: string
          status?: string
          token_symbol?: string | null
          updated_at?: string | null
          wallet_address?: string | null
        }
        Update: {
          created_at?: string | null
          department?: string | null
          email?: string
          first_name?: string | null
          id?: string
          invited_at?: string | null
          joined_at?: string | null
          last_name?: string | null
          network?: string | null
          organization_id?: string
          status?: string
          token_symbol?: string | null
          updated_at?: string | null
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_contributors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "payroll_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_employees: {
        Row: {
          created_at: string | null
          decrypted_amount: string | null
          employee_address: string
          encrypted_amount: string
          id: string
          payroll_batch_id: string
          token_address: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          decrypted_amount?: string | null
          employee_address: string
          encrypted_amount: string
          id?: string
          payroll_batch_id: string
          token_address: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          decrypted_amount?: string | null
          employee_address?: string
          encrypted_amount?: string
          id?: string
          payroll_batch_id?: string
          token_address?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_employees_payroll_batch_id_fkey"
            columns: ["payroll_batch_id"]
            isOneToOne: false
            referencedRelation: "payroll_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_org_members: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_org_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "payroll_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_organizations: {
        Row: {
          created_at: string | null
          id: string
          logo_url: string | null
          name: string
          owner_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          owner_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          name: string | null
          privy_user_id: string
          role: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          privy_user_id: string
          role?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          privy_user_id?: string
          role?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      public_claims: {
        Row: {
          amount: string | null
          created_at: string | null
          id: string | null
          status: string | null
          to_chain: string | null
          to_symbol: string | null
        }
        Insert: {
          amount?: string | null
          created_at?: string | null
          id?: string | null
          status?: string | null
          to_chain?: string | null
          to_symbol?: string | null
        }
        Update: {
          amount?: string | null
          created_at?: string | null
          id?: string | null
          status?: string | null
          to_chain?: string | null
          to_symbol?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

