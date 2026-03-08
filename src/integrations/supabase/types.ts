export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      amazon_tokens: {
        Row: {
          access_token: string | null
          created_at: string
          expires_at: string | null
          id: string
          marketplace_id: string
          refresh_token: string
          region: string
          selling_partner_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          marketplace_id?: string
          refresh_token: string
          region?: string
          selling_partner_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          marketplace_id?: string
          refresh_token?: string
          region?: string
          selling_partner_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          user_id: string
          value: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          user_id: string
          value?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          user_id?: string
          value?: string | null
        }
        Relationships: []
      }
      settlement_lines: {
        Row: {
          accounting_category: string | null
          amount: number | null
          amount_description: string | null
          amount_type: string | null
          created_at: string
          id: string
          marketplace_name: string | null
          order_id: string | null
          posted_date: string | null
          settlement_id: string
          sku: string | null
          transaction_type: string | null
          user_id: string
        }
        Insert: {
          accounting_category?: string | null
          amount?: number | null
          amount_description?: string | null
          amount_type?: string | null
          created_at?: string
          id?: string
          marketplace_name?: string | null
          order_id?: string | null
          posted_date?: string | null
          settlement_id: string
          sku?: string | null
          transaction_type?: string | null
          user_id: string
        }
        Update: {
          accounting_category?: string | null
          amount?: number | null
          amount_description?: string | null
          amount_type?: string | null
          created_at?: string
          id?: string
          marketplace_name?: string | null
          order_id?: string | null
          posted_date?: string | null
          settlement_id?: string
          sku?: string | null
          transaction_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      settlement_unmapped: {
        Row: {
          amount: number | null
          amount_description: string | null
          amount_type: string | null
          created_at: string
          id: string
          raw_row: Json | null
          settlement_id: string
          transaction_type: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          amount_description?: string | null
          amount_type?: string | null
          created_at?: string
          id?: string
          raw_row?: Json | null
          settlement_id: string
          transaction_type?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          amount_description?: string | null
          amount_type?: string | null
          created_at?: string
          id?: string
          raw_row?: Json | null
          settlement_id?: string
          transaction_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      settlements: {
        Row: {
          bank_deposit: number | null
          created_at: string
          deposit_date: string | null
          fba_fees: number | null
          gst_on_expenses: number | null
          gst_on_income: number | null
          id: string
          is_split_month: boolean | null
          marketplace: string | null
          net_ex_gst: number | null
          other_fees: number | null
          parser_version: string | null
          period_end: string
          period_start: string
          promotional_discounts: number | null
          reconciliation_status: string | null
          refunds: number | null
          reimbursements: number | null
          sales_principal: number | null
          sales_shipping: number | null
          seller_fees: number | null
          settlement_id: string
          split_month_1_data: Json | null
          split_month_2_data: Json | null
          status: string | null
          storage_fees: number | null
          updated_at: string
          user_id: string
          xero_journal_id: string | null
          xero_journal_id_1: string | null
          xero_journal_id_2: string | null
        }
        Insert: {
          bank_deposit?: number | null
          created_at?: string
          deposit_date?: string | null
          fba_fees?: number | null
          gst_on_expenses?: number | null
          gst_on_income?: number | null
          id?: string
          is_split_month?: boolean | null
          marketplace?: string | null
          net_ex_gst?: number | null
          other_fees?: number | null
          parser_version?: string | null
          period_end: string
          period_start: string
          promotional_discounts?: number | null
          reconciliation_status?: string | null
          refunds?: number | null
          reimbursements?: number | null
          sales_principal?: number | null
          sales_shipping?: number | null
          seller_fees?: number | null
          settlement_id: string
          split_month_1_data?: Json | null
          split_month_2_data?: Json | null
          status?: string | null
          storage_fees?: number | null
          updated_at?: string
          user_id: string
          xero_journal_id?: string | null
          xero_journal_id_1?: string | null
          xero_journal_id_2?: string | null
        }
        Update: {
          bank_deposit?: number | null
          created_at?: string
          deposit_date?: string | null
          fba_fees?: number | null
          gst_on_expenses?: number | null
          gst_on_income?: number | null
          id?: string
          is_split_month?: boolean | null
          marketplace?: string | null
          net_ex_gst?: number | null
          other_fees?: number | null
          parser_version?: string | null
          period_end?: string
          period_start?: string
          promotional_discounts?: number | null
          reconciliation_status?: string | null
          refunds?: number | null
          reimbursements?: number | null
          sales_principal?: number | null
          sales_shipping?: number | null
          seller_fees?: number | null
          settlement_id?: string
          split_month_1_data?: Json | null
          split_month_2_data?: Json | null
          status?: string | null
          storage_fees?: number | null
          updated_at?: string
          user_id?: string
          xero_journal_id?: string | null
          xero_journal_id_1?: string | null
          xero_journal_id_2?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      xero_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          scope: string | null
          tenant_id: string
          tenant_name: string | null
          token_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          scope?: string | null
          tenant_id: string
          tenant_name?: string | null
          token_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          scope?: string | null
          tenant_id?: string
          tenant_name?: string | null
          token_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
