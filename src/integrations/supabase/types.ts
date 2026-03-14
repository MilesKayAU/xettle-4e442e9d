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
      ai_usage: {
        Row: {
          created_at: string | null
          id: string
          month: string
          question_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          month: string
          question_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          month?: string
          question_count?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
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
      bank_transactions: {
        Row: {
          amount: number | null
          bank_account_id: string | null
          bank_account_name: string | null
          contact_name: string | null
          created_at: string | null
          currency: string | null
          date: string | null
          description: string | null
          fetched_at: string | null
          id: string
          reference: string | null
          source: string
          transaction_type: string | null
          user_id: string
          xero_status: string | null
          xero_transaction_id: string
        }
        Insert: {
          amount?: number | null
          bank_account_id?: string | null
          bank_account_name?: string | null
          contact_name?: string | null
          created_at?: string | null
          currency?: string | null
          date?: string | null
          description?: string | null
          fetched_at?: string | null
          id?: string
          reference?: string | null
          source?: string
          transaction_type?: string | null
          user_id: string
          xero_status?: string | null
          xero_transaction_id: string
        }
        Update: {
          amount?: number | null
          bank_account_id?: string | null
          bank_account_name?: string | null
          contact_name?: string | null
          created_at?: string | null
          currency?: string | null
          date?: string | null
          description?: string | null
          fetched_at?: string | null
          id?: string
          reference?: string | null
          source?: string
          transaction_type?: string | null
          user_id?: string
          xero_status?: string | null
          xero_transaction_id?: string
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
          alert_type: string | null
          candidate_tags: Json | null
          created_at: string | null
          deposit_amount: number | null
          deposit_date: string | null
          deposit_description: string | null
          detected_label: string | null
          detection_method: string | null
          first_seen_at: string | null
          id: string
          match_confidence: number | null
          order_count: number | null
          source_name: string
          status: string
          total_revenue: number | null
          user_id: string
        }
        Insert: {
          actioned_at?: string | null
          alert_type?: string | null
          candidate_tags?: Json | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_date?: string | null
          deposit_description?: string | null
          detected_label?: string | null
          detection_method?: string | null
          first_seen_at?: string | null
          id?: string
          match_confidence?: number | null
          order_count?: number | null
          source_name: string
          status?: string
          total_revenue?: number | null
          user_id: string
        }
        Update: {
          actioned_at?: string | null
          alert_type?: string | null
          candidate_tags?: Json | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_date?: string | null
          deposit_description?: string | null
          detected_label?: string | null
          detection_method?: string | null
          first_seen_at?: string | null
          id?: string
          match_confidence?: number | null
          order_count?: number | null
          source_name?: string
          status?: string
          total_revenue?: number | null
          user_id?: string
        }
        Relationships: []
      }
      community_contact_classifications: {
        Row: {
          category: string | null
          classification: string
          confidence_pct: number | null
          contact_name: string
          created_at: string
          id: string
          last_voted_at: string
          vote_count: number
        }
        Insert: {
          category?: string | null
          classification: string
          confidence_pct?: number | null
          contact_name: string
          created_at?: string
          id?: string
          last_voted_at?: string
          vote_count?: number
        }
        Update: {
          category?: string | null
          classification?: string
          confidence_pct?: number | null
          contact_name?: string
          created_at?: string
          id?: string
          last_voted_at?: string
          vote_count?: number
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
      gst_audit_summary: {
        Row: {
          breakdown: Json | null
          confidence_label: string | null
          confidence_score: number | null
          created_at: string
          difference: number | null
          id: string
          marketplace_adjustment_gst_estimate: number | null
          marketplace_fees_ex_gst: number | null
          marketplace_gst_on_fees_estimate: number | null
          marketplace_gst_on_sales_estimate: number | null
          marketplace_refund_gst_estimate: number | null
          marketplace_sales_ex_gst: number | null
          marketplace_tax_collected_by_platform: number | null
          marketplace_unknown_gst: number | null
          notes: Json | null
          period_end: string
          period_start: string
          updated_at: string
          user_id: string
          xero_gst: number | null
          xero_source_mode: string
        }
        Insert: {
          breakdown?: Json | null
          confidence_label?: string | null
          confidence_score?: number | null
          created_at?: string
          difference?: number | null
          id?: string
          marketplace_adjustment_gst_estimate?: number | null
          marketplace_fees_ex_gst?: number | null
          marketplace_gst_on_fees_estimate?: number | null
          marketplace_gst_on_sales_estimate?: number | null
          marketplace_refund_gst_estimate?: number | null
          marketplace_sales_ex_gst?: number | null
          marketplace_tax_collected_by_platform?: number | null
          marketplace_unknown_gst?: number | null
          notes?: Json | null
          period_end: string
          period_start: string
          updated_at?: string
          user_id: string
          xero_gst?: number | null
          xero_source_mode?: string
        }
        Update: {
          breakdown?: Json | null
          confidence_label?: string | null
          confidence_score?: number | null
          created_at?: string
          difference?: number | null
          id?: string
          marketplace_adjustment_gst_estimate?: number | null
          marketplace_fees_ex_gst?: number | null
          marketplace_gst_on_fees_estimate?: number | null
          marketplace_gst_on_sales_estimate?: number | null
          marketplace_refund_gst_estimate?: number | null
          marketplace_sales_ex_gst?: number | null
          marketplace_tax_collected_by_platform?: number | null
          marketplace_unknown_gst?: number | null
          notes?: Json | null
          period_end?: string
          period_start?: string
          updated_at?: string
          user_id?: string
          xero_gst?: number | null
          xero_source_mode?: string
        }
        Relationships: []
      }
      marketplace_account_mapping: {
        Row: {
          account_code: string
          account_name: string | null
          category: string
          created_at: string
          id: string
          marketplace_code: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_code: string
          account_name?: string | null
          category: string
          created_at?: string
          id?: string
          marketplace_code: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_code?: string
          account_name?: string | null
          category?: string
          created_at?: string
          id?: string
          marketplace_code?: string
          updated_at?: string
          user_id?: string
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
          suggested_at: string | null
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
          suggested_at?: string | null
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
          suggested_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      marketplace_discovery_log: {
        Row: {
          confirmed_at: string | null
          created_at: string
          detected_value: string
          detection_field: string
          id: string
          status: string
          suggested_code: string | null
          user_id: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          detected_value: string
          detection_field: string
          id?: string
          status?: string
          suggested_code?: string | null
          user_id: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          detected_value?: string
          detection_field?: string
          id?: string
          status?: string
          suggested_code?: string | null
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
      marketplace_registry: {
        Row: {
          added_by: string | null
          bank_narration_patterns: Json | null
          country: string | null
          created_at: string | null
          detection_keywords: Json | null
          id: string
          is_active: boolean | null
          marketplace_code: string
          marketplace_name: string
          notes: string | null
          settlement_file_patterns: Json | null
          shopify_source_names: Json | null
          type: string | null
          updated_at: string | null
          xero_contact_patterns: Json | null
        }
        Insert: {
          added_by?: string | null
          bank_narration_patterns?: Json | null
          country?: string | null
          created_at?: string | null
          detection_keywords?: Json | null
          id?: string
          is_active?: boolean | null
          marketplace_code: string
          marketplace_name: string
          notes?: string | null
          settlement_file_patterns?: Json | null
          shopify_source_names?: Json | null
          type?: string | null
          updated_at?: string | null
          xero_contact_patterns?: Json | null
        }
        Update: {
          added_by?: string | null
          bank_narration_patterns?: Json | null
          country?: string | null
          created_at?: string | null
          detection_keywords?: Json | null
          id?: string
          is_active?: boolean | null
          marketplace_code?: string
          marketplace_name?: string
          notes?: string | null
          settlement_file_patterns?: Json | null
          shopify_source_names?: Json | null
          type?: string | null
          updated_at?: string | null
          xero_contact_patterns?: Json | null
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
      outstanding_invoices_cache: {
        Row: {
          amount_due: number | null
          contact_name: string | null
          currency_code: string | null
          date: string | null
          due_date: string | null
          fetched_at: string | null
          id: string
          invoice_number: string | null
          line_amount_types: string | null
          reference: string | null
          status: string | null
          sub_total: number | null
          total: number | null
          total_tax: number | null
          user_id: string
          xero_invoice_id: string
          xero_tenant_id: string | null
        }
        Insert: {
          amount_due?: number | null
          contact_name?: string | null
          currency_code?: string | null
          date?: string | null
          due_date?: string | null
          fetched_at?: string | null
          id?: string
          invoice_number?: string | null
          line_amount_types?: string | null
          reference?: string | null
          status?: string | null
          sub_total?: number | null
          total?: number | null
          total_tax?: number | null
          user_id: string
          xero_invoice_id: string
          xero_tenant_id?: string | null
        }
        Update: {
          amount_due?: number | null
          contact_name?: string | null
          currency_code?: string | null
          date?: string | null
          due_date?: string | null
          fetched_at?: string | null
          id?: string
          invoice_number?: string | null
          line_amount_types?: string | null
          reference?: string | null
          status?: string | null
          sub_total?: number | null
          total?: number | null
          total_tax?: number | null
          user_id?: string
          xero_invoice_id?: string
          xero_tenant_id?: string | null
        }
        Relationships: []
      }
      payment_processor_registry: {
        Row: {
          added_by: string | null
          bank_narration_patterns: Json | null
          country: string | null
          created_at: string | null
          detection_keywords: Json | null
          id: string
          is_active: boolean | null
          notes: string | null
          processor_code: string
          processor_name: string
          type: string | null
          xero_contact_patterns: Json | null
        }
        Insert: {
          added_by?: string | null
          bank_narration_patterns?: Json | null
          country?: string | null
          created_at?: string | null
          detection_keywords?: Json | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          processor_code: string
          processor_name: string
          type?: string | null
          xero_contact_patterns?: Json | null
        }
        Update: {
          added_by?: string | null
          bank_narration_patterns?: Json | null
          country?: string | null
          created_at?: string | null
          detection_keywords?: Json | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          processor_code?: string
          processor_name?: string
          type?: string | null
          xero_contact_patterns?: Json | null
        }
        Relationships: []
      }
      payment_verifications: {
        Row: {
          confidence_score: number | null
          created_at: string | null
          deposit_group_id: string | null
          gateway_code: string
          id: string
          match_amount: number | null
          match_confidence: string | null
          match_confirmed_at: string | null
          match_confirmed_by: string | null
          match_method: string | null
          narration: string | null
          order_count: number | null
          settlement_id: string
          transaction_date: string | null
          updated_at: string | null
          user_id: string
          xero_tx_id: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string | null
          deposit_group_id?: string | null
          gateway_code: string
          id?: string
          match_amount?: number | null
          match_confidence?: string | null
          match_confirmed_at?: string | null
          match_confirmed_by?: string | null
          match_method?: string | null
          narration?: string | null
          order_count?: number | null
          settlement_id: string
          transaction_date?: string | null
          updated_at?: string | null
          user_id: string
          xero_tx_id?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string | null
          deposit_group_id?: string | null
          gateway_code?: string
          id?: string
          match_amount?: number | null
          match_confidence?: string | null
          match_confirmed_at?: string | null
          match_confirmed_by?: string | null
          match_method?: string | null
          narration?: string | null
          order_count?: number | null
          settlement_id?: string
          transaction_date?: string | null
          updated_at?: string | null
          user_id?: string
          xero_tx_id?: string | null
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
      reconciliation_notes: {
        Row: {
          created_at: string | null
          created_by: string
          id: string
          item_id: string
          item_type: string
          note: string
          resolved: boolean | null
          resolved_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by: string
          id?: string
          item_id: string
          item_type: string
          note: string
          resolved?: boolean | null
          resolved_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string
          id?: string
          item_id?: string
          item_type?: string
          note?: string
          resolved?: boolean | null
          resolved_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      settlement_components: {
        Row: {
          advertising_costs: number | null
          commerce_gross_total: number | null
          components_used: Json | null
          created_at: string | null
          currency: string
          fees_ex_tax: number | null
          fees_tax: number | null
          formula_version: string | null
          gst_rate: number | null
          id: string
          marketplace_code: string
          other_adjustments: number | null
          payout_gst_inclusive: number | null
          payout_total: number | null
          payout_vs_deposit_diff: number | null
          period_end: string
          period_start: string
          promotional_discounts: number | null
          reconciled: boolean | null
          refunds_ex_tax: number | null
          refunds_tax: number | null
          reimbursements: number | null
          sales_ex_tax: number | null
          sales_tax: number | null
          settlement_id: string
          source: string | null
          storage_fees: number | null
          tax_collected_by_platform: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          advertising_costs?: number | null
          commerce_gross_total?: number | null
          components_used?: Json | null
          created_at?: string | null
          currency?: string
          fees_ex_tax?: number | null
          fees_tax?: number | null
          formula_version?: string | null
          gst_rate?: number | null
          id?: string
          marketplace_code: string
          other_adjustments?: number | null
          payout_gst_inclusive?: number | null
          payout_total?: number | null
          payout_vs_deposit_diff?: number | null
          period_end: string
          period_start: string
          promotional_discounts?: number | null
          reconciled?: boolean | null
          refunds_ex_tax?: number | null
          refunds_tax?: number | null
          reimbursements?: number | null
          sales_ex_tax?: number | null
          sales_tax?: number | null
          settlement_id: string
          source?: string | null
          storage_fees?: number | null
          tax_collected_by_platform?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          advertising_costs?: number | null
          commerce_gross_total?: number | null
          components_used?: Json | null
          created_at?: string | null
          currency?: string
          fees_ex_tax?: number | null
          fees_tax?: number | null
          formula_version?: string | null
          gst_rate?: number | null
          id?: string
          marketplace_code?: string
          other_adjustments?: number | null
          payout_gst_inclusive?: number | null
          payout_total?: number | null
          payout_vs_deposit_diff?: number | null
          period_end?: string
          period_start?: string
          promotional_discounts?: number | null
          reconciled?: boolean | null
          refunds_ex_tax?: number | null
          refunds_tax?: number | null
          reimbursements?: number | null
          sales_ex_tax?: number | null
          sales_tax?: number | null
          settlement_id?: string
          source?: string | null
          storage_fees?: number | null
          tax_collected_by_platform?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      settlement_id_aliases: {
        Row: {
          alias_id: string
          canonical_settlement_id: string
          created_at: string | null
          id: string
          source: string | null
          user_id: string
        }
        Insert: {
          alias_id: string
          canonical_settlement_id: string
          created_at?: string | null
          id?: string
          source?: string | null
          user_id: string
        }
        Update: {
          alias_id?: string
          canonical_settlement_id?: string
          created_at?: string | null
          id?: string
          source?: string | null
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
          connection_id: string | null
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
          connection_id?: string | null
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
          connection_id?: string | null
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
          advertising_costs: number | null
          bank_deposit: number | null
          bank_match_amount: number | null
          bank_match_confidence: string | null
          bank_match_confirmed_at: string | null
          bank_match_confirmed_by: string | null
          bank_match_method: string | null
          bank_tx_id: string | null
          bank_verified: boolean | null
          bank_verified_amount: number | null
          bank_verified_at: string | null
          bank_verified_by: string | null
          connection_id: string | null
          created_at: string
          deposit_date: string | null
          duplicate_of_settlement_id: string | null
          duplicate_reason: string | null
          fba_fees: number | null
          gst_on_expenses: number | null
          gst_on_income: number | null
          id: string
          is_hidden: boolean
          is_pre_boundary: boolean
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
          settlement_fingerprint: string | null
          settlement_id: string
          source: string
          source_reference: string | null
          split_month_1_data: Json | null
          split_month_2_data: Json | null
          status: string | null
          storage_fees: number | null
          sync_origin: string
          updated_at: string
          user_id: string
          xero_entries: Json | null
          xero_invoice_id: string | null
          xero_invoice_number: string | null
          xero_journal_id: string | null
          xero_journal_id_1: string | null
          xero_journal_id_2: string | null
          xero_status: string | null
          xero_type: string | null
        }
        Insert: {
          advertising_costs?: number | null
          bank_deposit?: number | null
          bank_match_amount?: number | null
          bank_match_confidence?: string | null
          bank_match_confirmed_at?: string | null
          bank_match_confirmed_by?: string | null
          bank_match_method?: string | null
          bank_tx_id?: string | null
          bank_verified?: boolean | null
          bank_verified_amount?: number | null
          bank_verified_at?: string | null
          bank_verified_by?: string | null
          connection_id?: string | null
          created_at?: string
          deposit_date?: string | null
          duplicate_of_settlement_id?: string | null
          duplicate_reason?: string | null
          fba_fees?: number | null
          gst_on_expenses?: number | null
          gst_on_income?: number | null
          id?: string
          is_hidden?: boolean
          is_pre_boundary?: boolean
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
          settlement_fingerprint?: string | null
          settlement_id: string
          source?: string
          source_reference?: string | null
          split_month_1_data?: Json | null
          split_month_2_data?: Json | null
          status?: string | null
          storage_fees?: number | null
          sync_origin?: string
          updated_at?: string
          user_id: string
          xero_entries?: Json | null
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_journal_id?: string | null
          xero_journal_id_1?: string | null
          xero_journal_id_2?: string | null
          xero_status?: string | null
          xero_type?: string | null
        }
        Update: {
          advertising_costs?: number | null
          bank_deposit?: number | null
          bank_match_amount?: number | null
          bank_match_confidence?: string | null
          bank_match_confirmed_at?: string | null
          bank_match_confirmed_by?: string | null
          bank_match_method?: string | null
          bank_tx_id?: string | null
          bank_verified?: boolean | null
          bank_verified_amount?: number | null
          bank_verified_at?: string | null
          bank_verified_by?: string | null
          connection_id?: string | null
          created_at?: string
          deposit_date?: string | null
          duplicate_of_settlement_id?: string | null
          duplicate_reason?: string | null
          fba_fees?: number | null
          gst_on_expenses?: number | null
          gst_on_income?: number | null
          id?: string
          is_hidden?: boolean
          is_pre_boundary?: boolean
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
          settlement_fingerprint?: string | null
          settlement_id?: string
          source?: string
          source_reference?: string | null
          split_month_1_data?: Json | null
          split_month_2_data?: Json | null
          status?: string | null
          storage_fees?: number | null
          sync_origin?: string
          updated_at?: string
          user_id?: string
          xero_entries?: Json | null
          xero_invoice_id?: string | null
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
          note_attributes: Json | null
          order_name: string | null
          processed_at: string | null
          shopify_order_id: number
          source_name: string | null
          synced_at: string | null
          tags: string | null
          total_discounts: number | null
          total_price: number | null
          total_tax: number | null
          user_id: string
        }
        Insert: {
          created_at_shopify?: string | null
          financial_status?: string | null
          gateway?: string | null
          id?: string
          note_attributes?: Json | null
          order_name?: string | null
          processed_at?: string | null
          shopify_order_id: number
          source_name?: string | null
          synced_at?: string | null
          tags?: string | null
          total_discounts?: number | null
          total_price?: number | null
          total_tax?: number | null
          user_id: string
        }
        Update: {
          created_at_shopify?: string | null
          financial_status?: string | null
          gateway?: string | null
          id?: string
          note_attributes?: Json | null
          order_name?: string | null
          processed_at?: string | null
          shopify_order_id?: number
          source_name?: string | null
          synced_at?: string | null
          tags?: string | null
          total_discounts?: number | null
          total_price?: number | null
          total_tax?: number | null
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
      sync_locks: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          integration: string
          lock_key: string
          owner_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          integration: string
          lock_key: string
          owner_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          integration?: string
          lock_key?: string
          owner_id?: string | null
          updated_at?: string | null
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
      user_contact_classifications: {
        Row: {
          category: string | null
          classification: string
          contact_name: string
          created_at: string
          id: string
          notes: string | null
          updated_at: string
          user_id: string
          xero_contact_id: string | null
        }
        Insert: {
          category?: string | null
          classification: string
          contact_name: string
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
          user_id: string
          xero_contact_id?: string | null
        }
        Update: {
          category?: string | null
          classification?: string
          contact_name?: string
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
          xero_contact_id?: string | null
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
          reference_hash: string | null
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
          reference_hash?: string | null
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
          reference_hash?: string | null
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
      xero_chart_of_accounts: {
        Row: {
          account_code: string | null
          account_name: string
          account_type: string | null
          description: string | null
          id: string
          is_active: boolean | null
          synced_at: string | null
          tax_type: string | null
          user_id: string
          xero_account_id: string | null
        }
        Insert: {
          account_code?: string | null
          account_name: string
          account_type?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          synced_at?: string | null
          tax_type?: string | null
          user_id: string
          xero_account_id?: string | null
        }
        Update: {
          account_code?: string | null
          account_name?: string
          account_type?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          synced_at?: string | null
          tax_type?: string | null
          user_id?: string
          xero_account_id?: string | null
        }
        Relationships: []
      }
      xero_contact_account_mappings: {
        Row: {
          account_code: string
          confidence_pct: number
          contact_name: string
          created_at: string
          id: string
          last_seen: string
          normalised_contact_key: string
          original_contact_name: string | null
          updated_at: string
          usage_count: number
          user_id: string
        }
        Insert: {
          account_code: string
          confidence_pct?: number
          contact_name: string
          created_at?: string
          id?: string
          last_seen?: string
          normalised_contact_key: string
          original_contact_name?: string | null
          updated_at?: string
          usage_count?: number
          user_id: string
        }
        Update: {
          account_code?: string
          confidence_pct?: number
          contact_name?: string
          created_at?: string
          id?: string
          last_seen?: string
          normalised_contact_key?: string
          original_contact_name?: string | null
          updated_at?: string
          usage_count?: number
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
      acquire_sync_lock: {
        Args: {
          p_integration: string
          p_lock_key: string
          p_ttl_seconds?: number
          p_user_id: string
        }
        Returns: Json
      }
      check_sync_cooldown: {
        Args: { p_key: string; p_user_id: string; p_window_seconds?: number }
        Returns: Json
      }
      get_channel_comparison: {
        Args: { p_user_id: string }
        Returns: {
          avg_fee_rate_pct: number
          date_range: string
          margin_pct: number
          marketplace: string
          total_all_fees: number
          total_fees_fba: number
          total_fees_other: number
          total_fees_seller: number
          total_fees_storage: number
          total_gross_sales: number
          total_gst_claimable: number
          total_gst_payable: number
          total_net_payout: number
          total_refunds: number
          total_settlements: number
        }[]
      }
      get_gst_liability_by_quarter: {
        Args: { p_user_id: string }
        Returns: {
          fees_total: number
          gst_claimable: number
          gst_payable: number
          net_gst_liability: number
          quarter: string
          quarter_end: string
          quarter_start: string
          sales_principal: number
          settlements_count: number
        }[]
      }
      get_marketplace_fee_analysis: {
        Args: { p_user_id: string }
        Returns: {
          fee_percentage: number
          gst_payable: number
          marketplace: string
          month: string
          net_amount: number
          sales_ex_gst: number
          settlement_count: number
          total_fees: number
        }[]
      }
      get_rolling_12_month_trend: {
        Args: { p_user_id: string }
        Returns: {
          gross_sales: number
          gst_on_income: number
          margin_pct: number
          net_deposit: number
          period_end: string
          period_label: string
          refunds_net: number
          settlement_count: number
          total_fees: number
        }[]
      }
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      release_sync_lock: {
        Args: { p_integration: string; p_lock_key: string; p_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "moderator"
        | "user"
        | "paid"
        | "starter"
        | "pro"
        | "trial"
        | "free"
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
      app_role: [
        "admin",
        "moderator",
        "user",
        "paid",
        "starter",
        "pro",
        "trial",
        "free",
      ],
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
