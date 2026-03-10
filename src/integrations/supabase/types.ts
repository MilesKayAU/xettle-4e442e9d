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
      bug_reports: {
        Row: {
          ai_classification: string | null
          ai_complexity: string | null
          ai_lovable_prompt: string | null
          ai_summary: string | null
          console_errors: Json | null
          created_at: string
          description: string
          id: string
          notify_submitter: boolean
          owner_notes: string | null
          page_url: string | null
          resolved_at: string | null
          screenshot_base64: string | null
          severity: string
          status: string
          submitted_by: string
        }
        Insert: {
          ai_classification?: string | null
          ai_complexity?: string | null
          ai_lovable_prompt?: string | null
          ai_summary?: string | null
          console_errors?: Json | null
          created_at?: string
          description: string
          id?: string
          notify_submitter?: boolean
          owner_notes?: string | null
          page_url?: string | null
          resolved_at?: string | null
          screenshot_base64?: string | null
          severity?: string
          status?: string
          submitted_by: string
        }
        Update: {
          ai_classification?: string | null
          ai_complexity?: string | null
          ai_lovable_prompt?: string | null
          ai_summary?: string | null
          console_errors?: Json | null
          created_at?: string
          description?: string
          id?: string
          notify_submitter?: boolean
          owner_notes?: string | null
          page_url?: string | null
          resolved_at?: string | null
          screenshot_base64?: string | null
          severity?: string
          status?: string
          submitted_by?: string
        }
        Relationships: []
      }
      channel_alerts: {
        Row: {
          actioned_at: string | null
          created_at: string | null
          first_seen_at: string | null
          id: string
          order_count: number | null
          source_name: string
          status: string
          total_revenue: number | null
          user_id: string
        }
        Insert: {
          actioned_at?: string | null
          created_at?: string | null
          first_seen_at?: string | null
          id?: string
          order_count?: number | null
          source_name: string
          status?: string
          total_revenue?: number | null
          user_id: string
        }
        Update: {
          actioned_at?: string | null
          created_at?: string | null
          first_seen_at?: string | null
          id?: string
          order_count?: number | null
          source_name?: string
          status?: string
          total_revenue?: number | null
          user_id?: string
        }
        Relationships: []
      }
      entity_library: {
        Row: {
          accounting_impact: string
          confirmed_count: number | null
          created_at: string | null
          detection_field: string | null
          entity_name: string
          entity_type: string
          id: string
          notes: string | null
          source: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          accounting_impact: string
          confirmed_count?: number | null
          created_at?: string | null
          detection_field?: string | null
          entity_name: string
          entity_type: string
          id?: string
          notes?: string | null
          source?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          accounting_impact?: string
          confirmed_count?: number | null
          created_at?: string | null
          detection_field?: string | null
          entity_name?: string
          entity_type?: string
          id?: string
          notes?: string | null
          source?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      marketplace_ad_spend: {
        Row: {
          created_at: string
          currency: string
          id: string
          marketplace_code: string
          notes: string | null
          period_end: string
          period_start: string
          source: string
          spend_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          marketplace_code: string
          notes?: string | null
          period_end: string
          period_start: string
          source?: string
          spend_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          marketplace_code?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          source?: string
          spend_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      marketplace_connections: {
        Row: {
          connection_status: string
          connection_type: string
          country_code: string
          created_at: string
          id: string
          marketplace_code: string
          marketplace_name: string
          settings: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_status?: string
          connection_type?: string
          country_code?: string
          created_at?: string
          id?: string
          marketplace_code: string
          marketplace_name: string
          settings?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_status?: string
          connection_type?: string
          country_code?: string
          created_at?: string
          id?: string
          marketplace_code?: string
          marketplace_name?: string
          settings?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      marketplace_fee_alerts: {
        Row: {
          created_at: string
          deviation_pct: number
          expected_rate: number
          fee_type: Database["public"]["Enums"]["fee_observation_type"]
          id: string
          marketplace_code: string
          observed_rate: number
          settlement_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deviation_pct: number
          expected_rate: number
          fee_type: Database["public"]["Enums"]["fee_observation_type"]
          id?: string
          marketplace_code: string
          observed_rate: number
          settlement_id: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deviation_pct?: number
          expected_rate?: number
          fee_type?: Database["public"]["Enums"]["fee_observation_type"]
          id?: string
          marketplace_code?: string
          observed_rate?: number
          settlement_id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      marketplace_fee_observations: {
        Row: {
          base_amount: number
          created_at: string
          currency: string
          fee_category: string
          fee_type: Database["public"]["Enums"]["fee_observation_type"]
          id: string
          marketplace_code: string
          observation_method: Database["public"]["Enums"]["observation_method"]
          observed_amount: number
          observed_rate: number | null
          period_end: string
          period_start: string
          settlement_id: string
          user_id: string
        }
        Insert: {
          base_amount: number
          created_at?: string
          currency?: string
          fee_category?: string
          fee_type: Database["public"]["Enums"]["fee_observation_type"]
          id?: string
          marketplace_code: string
          observation_method?: Database["public"]["Enums"]["observation_method"]
          observed_amount: number
          observed_rate?: number | null
          period_end: string
          period_start: string
          settlement_id: string
          user_id: string
        }
        Update: {
          base_amount?: number
          created_at?: string
          currency?: string
          fee_category?: string
          fee_type?: Database["public"]["Enums"]["fee_observation_type"]
          id?: string
          marketplace_code?: string
          observation_method?: Database["public"]["Enums"]["observation_method"]
          observed_amount?: number
          observed_rate?: number | null
          period_end?: string
          period_start?: string
          settlement_id?: string
          user_id?: string
        }
        Relationships: []
      }
      marketplace_file_fingerprints: {
        Row: {
          column_mapping: Json
          column_signature: Json
          created_at: string
          file_pattern: string | null
          id: string
          is_multi_marketplace: boolean | null
          marketplace_code: string
          reconciliation_type: string | null
          split_column: string | null
          split_mappings: Json | null
          user_id: string
        }
        Insert: {
          column_mapping?: Json
          column_signature?: Json
          created_at?: string
          file_pattern?: string | null
          id?: string
          is_multi_marketplace?: boolean | null
          marketplace_code: string
          reconciliation_type?: string | null
          split_column?: string | null
          split_mappings?: Json | null
          user_id: string
        }
        Update: {
          column_mapping?: Json
          column_signature?: Json
          created_at?: string
          file_pattern?: string | null
          id?: string
          is_multi_marketplace?: boolean | null
          marketplace_code?: string
          reconciliation_type?: string | null
          split_column?: string | null
          split_mappings?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      marketplace_fingerprints: {
        Row: {
          confidence: number
          created_at: string
          field: string
          id: string
          marketplace_code: string
          match_count: number
          pattern: string
          source: string
          user_id: string | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          field: string
          id?: string
          marketplace_code: string
          match_count?: number
          pattern: string
          source?: string
          user_id?: string | null
        }
        Update: {
          confidence?: number
          created_at?: string
          field?: string
          id?: string
          marketplace_code?: string
          match_count?: number
          pattern?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      marketplace_shipping_costs: {
        Row: {
          cost_per_order: number
          created_at: string
          currency: string
          id: string
          marketplace_code: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cost_per_order?: number
          created_at?: string
          currency?: string
          id?: string
          marketplace_code: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cost_per_order?: number
          created_at?: string
          currency?: string
          id?: string
          marketplace_code?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      marketplace_validation: {
        Row: {
          bank_amount: number | null
          bank_matched: boolean | null
          bank_matched_at: string | null
          bank_reference: string | null
          created_at: string | null
          id: string
          last_checked_at: string | null
          marketplace_code: string
          marketplace_period_id: string | null
          orders_count: number | null
          orders_fetched_at: string | null
          orders_found: boolean | null
          orders_total: number | null
          overall_status: string | null
          period_end: string
          period_label: string
          period_start: string
          processing_completed_at: string | null
          processing_error: string | null
          processing_started_at: string | null
          processing_state: string | null
          reconciliation_confidence: number | null
          reconciliation_confidence_reason: string | null
          reconciliation_difference: number | null
          reconciliation_status: string | null
          settlement_id: string | null
          settlement_net: number | null
          settlement_uploaded: boolean | null
          settlement_uploaded_at: string | null
          updated_at: string | null
          user_id: string
          xero_invoice_id: string | null
          xero_pushed: boolean | null
          xero_pushed_at: string | null
        }
        Insert: {
          bank_amount?: number | null
          bank_matched?: boolean | null
          bank_matched_at?: string | null
          bank_reference?: string | null
          created_at?: string | null
          id?: string
          last_checked_at?: string | null
          marketplace_code: string
          marketplace_period_id?: string | null
          orders_count?: number | null
          orders_fetched_at?: string | null
          orders_found?: boolean | null
          orders_total?: number | null
          overall_status?: string | null
          period_end: string
          period_label: string
          period_start: string
          processing_completed_at?: string | null
          processing_error?: string | null
          processing_started_at?: string | null
          processing_state?: string | null
          reconciliation_confidence?: number | null
          reconciliation_confidence_reason?: string | null
          reconciliation_difference?: number | null
          reconciliation_status?: string | null
          settlement_id?: string | null
          settlement_net?: number | null
          settlement_uploaded?: boolean | null
          settlement_uploaded_at?: string | null
          updated_at?: string | null
          user_id: string
          xero_invoice_id?: string | null
          xero_pushed?: boolean | null
          xero_pushed_at?: string | null
        }
        Update: {
          bank_amount?: number | null
          bank_matched?: boolean | null
          bank_matched_at?: string | null
          bank_reference?: string | null
          created_at?: string | null
          id?: string
          last_checked_at?: string | null
          marketplace_code?: string
          marketplace_period_id?: string | null
          orders_count?: number | null
          orders_fetched_at?: string | null
          orders_found?: boolean | null
          orders_total?: number | null
          overall_status?: string | null
          period_end?: string
          period_label?: string
          period_start?: string
          processing_completed_at?: string | null
          processing_error?: string | null
          processing_started_at?: string | null
          processing_state?: string | null
          reconciliation_confidence?: number | null
          reconciliation_confidence_reason?: string | null
          reconciliation_difference?: number | null
          reconciliation_status?: string | null
          settlement_id?: string | null
          settlement_net?: number | null
          settlement_uploaded?: boolean | null
          settlement_uploaded_at?: string | null
          updated_at?: string | null
          user_id?: string
          xero_invoice_id?: string | null
          xero_pushed?: boolean | null
          xero_pushed_at?: string | null
        }
        Relationships: []
      }
      marketplaces: {
        Row: {
          created_at: string
          currency: string
          gst_model: string
          id: string
          is_active: boolean
          marketplace_code: string
          name: string
          payment_delay_days: number
          settlement_frequency: string
          settlement_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          gst_model?: string
          id?: string
          is_active?: boolean
          marketplace_code: string
          name: string
          payment_delay_days?: number
          settlement_frequency?: string
          settlement_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          gst_model?: string
          id?: string
          is_active?: boolean
          marketplace_code?: string
          name?: string
          payment_delay_days?: number
          settlement_frequency?: string
          settlement_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_costs: {
        Row: {
          cost: number
          created_at: string
          currency: string
          id: string
          label: string | null
          sku: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cost?: number
          created_at?: string
          currency?: string
          id?: string
          label?: string | null
          sku: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cost?: number
          created_at?: string
          currency?: string
          id?: string
          label?: string | null
          sku?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reconciliation_checks: {
        Row: {
          actual_commission: number | null
          created_at: string | null
          difference: number | null
          expected_commission: number | null
          id: string
          marketplace_code: string
          notes: string | null
          period_end: string
          period_label: string
          period_start: string
          settlement_net_received: number | null
          shopify_order_total: number | null
          status: string | null
          unmatched_orders: string[] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          actual_commission?: number | null
          created_at?: string | null
          difference?: number | null
          expected_commission?: number | null
          id?: string
          marketplace_code: string
          notes?: string | null
          period_end: string
          period_label: string
          period_start: string
          settlement_net_received?: number | null
          shopify_order_total?: number | null
          status?: string | null
          unmatched_orders?: string[] | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          actual_commission?: number | null
          created_at?: string | null
          difference?: number | null
          expected_commission?: number | null
          id?: string
          marketplace_code?: string
          notes?: string | null
          period_end?: string
          period_label?: string
          period_start?: string
          settlement_net_received?: number | null
          shopify_order_total?: number | null
          status?: string | null
          unmatched_orders?: string[] | null
          updated_at?: string | null
          user_id?: string
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
      settlement_profit: {
        Row: {
          calculated_at: string
          created_at: string
          gross_profit: number
          gross_revenue: number
          id: string
          margin_percent: number
          marketplace_code: string
          marketplace_fees: number
          orders_count: number
          period_label: string
          settlement_id: string
          total_cogs: number
          uncosted_revenue: number
          uncosted_sku_count: number
          units_sold: number
          user_id: string
        }
        Insert: {
          calculated_at?: string
          created_at?: string
          gross_profit?: number
          gross_revenue?: number
          id?: string
          margin_percent?: number
          marketplace_code: string
          marketplace_fees?: number
          orders_count?: number
          period_label: string
          settlement_id: string
          total_cogs?: number
          uncosted_revenue?: number
          uncosted_sku_count?: number
          units_sold?: number
          user_id: string
        }
        Update: {
          calculated_at?: string
          created_at?: string
          gross_profit?: number
          gross_revenue?: number
          id?: string
          margin_percent?: number
          marketplace_code?: string
          marketplace_fees?: number
          orders_count?: number
          period_label?: string
          settlement_id?: string
          total_cogs?: number
          uncosted_revenue?: number
          uncosted_sku_count?: number
          units_sold?: number
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
          bank_verified: boolean | null
          bank_verified_amount: number | null
          bank_verified_at: string | null
          bank_verified_by: string | null
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
          push_retry_count: number
          raw_payload: Json | null
          reconciliation_status: string | null
          refunds: number | null
          reimbursements: number | null
          sales_principal: number | null
          sales_shipping: number | null
          seller_fees: number | null
          settlement_id: string
          source: string
          split_month_1_data: Json | null
          split_month_2_data: Json | null
          status: string | null
          storage_fees: number | null
          updated_at: string
          user_id: string
          xero_invoice_number: string | null
          xero_journal_id: string | null
          xero_journal_id_1: string | null
          xero_journal_id_2: string | null
          xero_status: string | null
          xero_type: string | null
        }
        Insert: {
          bank_deposit?: number | null
          bank_verified?: boolean | null
          bank_verified_amount?: number | null
          bank_verified_at?: string | null
          bank_verified_by?: string | null
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
          push_retry_count?: number
          raw_payload?: Json | null
          reconciliation_status?: string | null
          refunds?: number | null
          reimbursements?: number | null
          sales_principal?: number | null
          sales_shipping?: number | null
          seller_fees?: number | null
          settlement_id: string
          source?: string
          split_month_1_data?: Json | null
          split_month_2_data?: Json | null
          status?: string | null
          storage_fees?: number | null
          updated_at?: string
          user_id: string
          xero_invoice_number?: string | null
          xero_journal_id?: string | null
          xero_journal_id_1?: string | null
          xero_journal_id_2?: string | null
          xero_status?: string | null
          xero_type?: string | null
        }
        Update: {
          bank_deposit?: number | null
          bank_verified?: boolean | null
          bank_verified_amount?: number | null
          bank_verified_at?: string | null
          bank_verified_by?: string | null
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
          push_retry_count?: number
          raw_payload?: Json | null
          reconciliation_status?: string | null
          refunds?: number | null
          reimbursements?: number | null
          sales_principal?: number | null
          sales_shipping?: number | null
          seller_fees?: number | null
          settlement_id?: string
          source?: string
          split_month_1_data?: Json | null
          split_month_2_data?: Json | null
          status?: string | null
          storage_fees?: number | null
          updated_at?: string
          user_id?: string
          xero_invoice_number?: string | null
          xero_journal_id?: string | null
          xero_journal_id_1?: string | null
          xero_journal_id_2?: string | null
          xero_status?: string | null
          xero_type?: string | null
        }
        Relationships: []
      }
      shopify_orders: {
        Row: {
          created_at_shopify: string | null
          financial_status: string | null
          gateway: string | null
          id: string
          order_name: string | null
          shopify_order_id: number
          source_name: string | null
          synced_at: string | null
          tags: string | null
          total_price: number | null
          user_id: string
        }
        Insert: {
          created_at_shopify?: string | null
          financial_status?: string | null
          gateway?: string | null
          id?: string
          order_name?: string | null
          shopify_order_id: number
          source_name?: string | null
          synced_at?: string | null
          tags?: string | null
          total_price?: number | null
          user_id: string
        }
        Update: {
          created_at_shopify?: string | null
          financial_status?: string | null
          gateway?: string | null
          id?: string
          order_name?: string | null
          shopify_order_id?: number
          source_name?: string | null
          synced_at?: string | null
          tags?: string | null
          total_price?: number | null
          user_id?: string
        }
        Relationships: []
      }
      shopify_sub_channels: {
        Row: {
          created_at: string | null
          first_seen_at: string | null
          id: string
          ignored: boolean
          marketplace_code: string | null
          marketplace_label: string
          order_count: number | null
          settlement_type: string
          source_name: string
          total_revenue: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          first_seen_at?: string | null
          id?: string
          ignored?: boolean
          marketplace_code?: string | null
          marketplace_label: string
          order_count?: number | null
          settlement_type?: string
          source_name: string
          total_revenue?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          first_seen_at?: string | null
          id?: string
          ignored?: boolean
          marketplace_code?: string | null
          marketplace_label?: string
          order_count?: number | null
          settlement_type?: string
          source_name?: string
          total_revenue?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shopify_tokens: {
        Row: {
          access_token: string
          id: string
          installed_at: string | null
          scope: string | null
          shop_domain: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          id?: string
          installed_at?: string | null
          scope?: string | null
          shop_domain: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          id?: string
          installed_at?: string | null
          scope?: string | null
          shop_domain?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sync_history: {
        Row: {
          created_at: string
          details: Json | null
          error_message: string | null
          event_type: string
          id: string
          settlements_affected: number | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          error_message?: string | null
          event_type: string
          id?: string
          settlements_affected?: number | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          error_message?: string | null
          event_type?: string
          id?: string
          settlements_affected?: number | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      system_events: {
        Row: {
          created_at: string | null
          details: Json | null
          event_type: string
          id: string
          marketplace_code: string | null
          period_label: string | null
          settlement_id: string | null
          severity: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          details?: Json | null
          event_type: string
          id?: string
          marketplace_code?: string | null
          period_label?: string | null
          settlement_id?: string | null
          severity?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          details?: Json | null
          event_type?: string
          id?: string
          marketplace_code?: string | null
          period_label?: string | null
          settlement_id?: string | null
          severity?: string | null
          user_id?: string
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
      xero_accounting_matches: {
        Row: {
          confidence: number
          created_at: string
          id: string
          marketplace_code: string
          match_method: string
          matched_amount: number | null
          matched_contact: string | null
          matched_date: string | null
          matched_reference: string | null
          notes: string | null
          settlement_id: string
          updated_at: string
          user_id: string
          xero_invoice_id: string | null
          xero_invoice_number: string | null
          xero_status: string | null
          xero_type: string | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          id?: string
          marketplace_code: string
          match_method?: string
          matched_amount?: number | null
          matched_contact?: string | null
          matched_date?: string | null
          matched_reference?: string | null
          notes?: string | null
          settlement_id: string
          updated_at?: string
          user_id: string
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_status?: string | null
          xero_type?: string | null
        }
        Update: {
          confidence?: number
          created_at?: string
          id?: string
          marketplace_code?: string
          match_method?: string
          matched_amount?: number | null
          matched_contact?: string | null
          matched_date?: string | null
          matched_reference?: string | null
          notes?: string | null
          settlement_id?: string
          updated_at?: string
          user_id?: string
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_status?: string | null
          xero_type?: string | null
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
      app_role: "admin" | "moderator" | "user" | "paid" | "starter" | "pro"
      fee_observation_type:
        | "commission"
        | "referral"
        | "fba_fulfilment"
        | "storage"
        | "refund_rate"
        | "shipping_fee"
        | "transaction_fee"
      observation_method: "parser" | "derived" | "manual"
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
      app_role: ["admin", "moderator", "user", "paid", "starter", "pro"],
      fee_observation_type: [
        "commission",
        "referral",
        "fba_fulfilment",
        "storage",
        "refund_rate",
        "shipping_fee",
        "transaction_fee",
      ],
      observation_method: ["parser", "derived", "manual"],
    },
  },
} as const
