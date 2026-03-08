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
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      alibaba_orders: {
        Row: {
          amount_aud: number | null
          attachments: Json | null
          country: string | null
          created_at: string
          currency_code: string | null
          description: string | null
          due_date: string | null
          id: string
          invoice_date: string | null
          invoice_type: string | null
          line_items: Json | null
          notes: string | null
          order_id: string | null
          order_url: string | null
          pay_date: string | null
          payment_method: string | null
          payment_notes: string | null
          pdf_file_path: string | null
          status: string
          supplier_name: string | null
          total_amount: number | null
          updated_at: string
          user_id: string
          xero_invoice_id: string | null
          xero_invoice_number: string | null
          xero_purchase_order_id: string | null
          xero_sync_error: string | null
          xero_sync_status: string | null
          xero_synced_at: string | null
        }
        Insert: {
          amount_aud?: number | null
          attachments?: Json | null
          country?: string | null
          created_at?: string
          currency_code?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_type?: string | null
          line_items?: Json | null
          notes?: string | null
          order_id?: string | null
          order_url?: string | null
          pay_date?: string | null
          payment_method?: string | null
          payment_notes?: string | null
          pdf_file_path?: string | null
          status?: string
          supplier_name?: string | null
          total_amount?: number | null
          updated_at?: string
          user_id: string
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_purchase_order_id?: string | null
          xero_sync_error?: string | null
          xero_sync_status?: string | null
          xero_synced_at?: string | null
        }
        Update: {
          amount_aud?: number | null
          attachments?: Json | null
          country?: string | null
          created_at?: string
          currency_code?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_type?: string | null
          line_items?: Json | null
          notes?: string | null
          order_id?: string | null
          order_url?: string | null
          pay_date?: string | null
          payment_method?: string | null
          payment_notes?: string | null
          pdf_file_path?: string | null
          status?: string
          supplier_name?: string | null
          total_amount?: number | null
          updated_at?: string
          user_id?: string
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_purchase_order_id?: string | null
          xero_sync_error?: string | null
          xero_sync_status?: string | null
          xero_synced_at?: string | null
        }
        Relationships: []
      }
      amazon_products: {
        Row: {
          asin: string
          brand: string | null
          category: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          features: Json | null
          id: string
          image_urls: Json | null
          local_product_id: string | null
          price: number | null
          product_url: string | null
          specifications: Json | null
          status: string | null
          sync_status: string | null
          synced_at: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          asin: string
          brand?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          features?: Json | null
          id?: string
          image_urls?: Json | null
          local_product_id?: string | null
          price?: number | null
          product_url?: string | null
          specifications?: Json | null
          status?: string | null
          sync_status?: string | null
          synced_at?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          asin?: string
          brand?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          features?: Json | null
          id?: string
          image_urls?: Json | null
          local_product_id?: string | null
          price?: number | null
          product_url?: string | null
          specifications?: Json | null
          status?: string | null
          sync_status?: string | null
          synced_at?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      amazon_sync_logs: {
        Row: {
          created_by: string | null
          details: string | null
          end_time: string | null
          errors: Json | null
          id: string
          products_synced: number | null
          start_time: string | null
          status: string | null
        }
        Insert: {
          created_by?: string | null
          details?: string | null
          end_time?: string | null
          errors?: Json | null
          id?: string
          products_synced?: number | null
          start_time?: string | null
          status?: string | null
        }
        Update: {
          created_by?: string | null
          details?: string | null
          end_time?: string | null
          errors?: Json | null
          id?: string
          products_synced?: number | null
          start_time?: string | null
          status?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      blog_posts: {
        Row: {
          author_id: string
          content: string
          created_at: string
          excerpt: string | null
          featured_image: string | null
          id: string
          published: boolean | null
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          excerpt?: string | null
          featured_image?: string | null
          id?: string
          published?: boolean | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          excerpt?: string | null
          featured_image?: string | null
          id?: string
          published?: boolean | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      brand_messages: {
        Row: {
          admin_response: string | null
          brand_id: string
          company_name: string
          created_at: string | null
          id: string
          message: string
          sender_email: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          admin_response?: string | null
          brand_id: string
          company_name: string
          created_at?: string | null
          id?: string
          message: string
          sender_email: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          admin_response?: string | null
          brand_id?: string
          company_name?: string
          created_at?: string | null
          id?: string
          message?: string
          sender_email?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_messages_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_profiles: {
        Row: {
          contact_email: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
          verified: boolean | null
          website: string | null
        }
        Insert: {
          contact_email?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
          verified?: boolean | null
          website?: string | null
        }
        Update: {
          contact_email?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
          verified?: boolean | null
          website?: string | null
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string | null
          email: string
          id: string
          message: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          message: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          message?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      data_uploads: {
        Row: {
          ai_analysis: Json | null
          column_mapping: Json | null
          created_at: string
          error_message: string | null
          file_size: number | null
          file_type: string
          filename: string
          id: string
          insights: Json | null
          processed_data: Json | null
          raw_data: Json | null
          updated_at: string
          upload_status: string
          user_id: string
        }
        Insert: {
          ai_analysis?: Json | null
          column_mapping?: Json | null
          created_at?: string
          error_message?: string | null
          file_size?: number | null
          file_type: string
          filename: string
          id?: string
          insights?: Json | null
          processed_data?: Json | null
          raw_data?: Json | null
          updated_at?: string
          upload_status?: string
          user_id: string
        }
        Update: {
          ai_analysis?: Json | null
          column_mapping?: Json | null
          created_at?: string
          error_message?: string | null
          file_size?: number | null
          file_type?: string
          filename?: string
          id?: string
          insights?: Json | null
          processed_data?: Json | null
          raw_data?: Json | null
          updated_at?: string
          upload_status?: string
          user_id?: string
        }
        Relationships: []
      }
      distributor_inquiries: {
        Row: {
          company_name: string | null
          created_at: string | null
          email: string
          full_name: string
          id: string
          message: string | null
          phone: string | null
          region: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          message?: string | null
          phone?: string | null
          region?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          message?: string | null
          phone?: string | null
          region?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      forecast_calculations: {
        Row: {
          cog_per_unit: number | null
          created_at: string
          days_of_stock_remaining: number | null
          forecast_period_months: number
          forecasted_profit: number | null
          forecasted_sales: number | null
          id: string
          inventory_raw_id: string
          missed_profit: number | null
          reorder_quantity_required: number | null
          stockout_risk_days: number | null
          stockout_warning: string | null
          total_cashflow_required: number | null
          updated_at: string
          urgency_level: string | null
          user_id: string
        }
        Insert: {
          cog_per_unit?: number | null
          created_at?: string
          days_of_stock_remaining?: number | null
          forecast_period_months?: number
          forecasted_profit?: number | null
          forecasted_sales?: number | null
          id?: string
          inventory_raw_id: string
          missed_profit?: number | null
          reorder_quantity_required?: number | null
          stockout_risk_days?: number | null
          stockout_warning?: string | null
          total_cashflow_required?: number | null
          updated_at?: string
          urgency_level?: string | null
          user_id: string
        }
        Update: {
          cog_per_unit?: number | null
          created_at?: string
          days_of_stock_remaining?: number | null
          forecast_period_months?: number
          forecasted_profit?: number | null
          forecasted_sales?: number | null
          id?: string
          inventory_raw_id?: string
          missed_profit?: number | null
          reorder_quantity_required?: number | null
          stockout_risk_days?: number | null
          stockout_warning?: string | null
          total_cashflow_required?: number | null
          updated_at?: string
          urgency_level?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_calculations_inventory_raw_id_fkey"
            columns: ["inventory_raw_id"]
            isOneToOne: false
            referencedRelation: "uploaded_inventory_raw"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_settings_overrides: {
        Row: {
          buffer_days: number | null
          cost_override: number | null
          created_at: string
          id: string
          inventory_raw_id: string
          lead_time_days: number | null
          margin_override: number | null
          updated_at: string
          user_id: string
          velocity_override: number | null
        }
        Insert: {
          buffer_days?: number | null
          cost_override?: number | null
          created_at?: string
          id?: string
          inventory_raw_id: string
          lead_time_days?: number | null
          margin_override?: number | null
          updated_at?: string
          user_id: string
          velocity_override?: number | null
        }
        Update: {
          buffer_days?: number | null
          cost_override?: number | null
          created_at?: string
          id?: string
          inventory_raw_id?: string
          lead_time_days?: number | null
          margin_override?: number | null
          updated_at?: string
          user_id?: string
          velocity_override?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_settings_overrides_inventory_raw_id_fkey"
            columns: ["inventory_raw_id"]
            isOneToOne: false
            referencedRelation: "uploaded_inventory_raw"
            referencedColumns: ["id"]
          },
        ]
      }
      ignored_products: {
        Row: {
          created_at: string
          id: string
          ignore_type: string
          reason: string | null
          sku: string
          updated_at: string
          upload_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ignore_type: string
          reason?: string | null
          sku: string
          updated_at?: string
          upload_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ignore_type?: string
          reason?: string | null
          sku?: string
          updated_at?: string
          upload_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      invoice_suppliers: {
        Row: {
          contact_name: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          contact_name?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          contact_name?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      logistics_shipments: {
        Row: {
          actual_arrival: string | null
          amazon_clearance_date: string | null
          cartons: number | null
          created_at: string | null
          destination_country: string | null
          destination_detail: string | null
          eta: string | null
          etd: string | null
          goods_name: string
          id: string
          notes: string | null
          reference_number: string | null
          ship_date: string | null
          shipping_method: string | null
          source_year: number | null
          status: string | null
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string | null
          upload_batch_id: string | null
          user_id: string | null
          vessel_name: string | null
        }
        Insert: {
          actual_arrival?: string | null
          amazon_clearance_date?: string | null
          cartons?: number | null
          created_at?: string | null
          destination_country?: string | null
          destination_detail?: string | null
          eta?: string | null
          etd?: string | null
          goods_name: string
          id?: string
          notes?: string | null
          reference_number?: string | null
          ship_date?: string | null
          shipping_method?: string | null
          source_year?: number | null
          status?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string | null
          upload_batch_id?: string | null
          user_id?: string | null
          vessel_name?: string | null
        }
        Update: {
          actual_arrival?: string | null
          amazon_clearance_date?: string | null
          cartons?: number | null
          created_at?: string | null
          destination_country?: string | null
          destination_detail?: string | null
          eta?: string | null
          etd?: string | null
          goods_name?: string
          id?: string
          notes?: string | null
          reference_number?: string | null
          ship_date?: string | null
          shipping_method?: string | null
          source_year?: number | null
          status?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string | null
          upload_batch_id?: string | null
          user_id?: string | null
          vessel_name?: string | null
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          created_at: string | null
          email: string
          id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      product_images: {
        Row: {
          brand_name: string
          created_at: string | null
          id: string
          image_url: string
          product_id: string
          status: string | null
          uploaded_by: string | null
        }
        Insert: {
          brand_name: string
          created_at?: string | null
          id?: string
          image_url: string
          product_id: string
          status?: string | null
          uploaded_by?: string | null
        }
        Update: {
          brand_name?: string
          created_at?: string | null
          id?: string
          image_url?: string
          product_id?: string
          status?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      product_submissions: {
        Row: {
          approved: boolean | null
          brand: string
          country: string | null
          createdat: string | null
          description: string | null
          id: string
          imageurl: string | null
          ingredients: string | null
          name: string
          owner_id: string | null
          pvapercentage: number | null
          pvastatus: string | null
          type: string
          updatedat: string | null
          videourl: string | null
          websiteurl: string | null
        }
        Insert: {
          approved?: boolean | null
          brand: string
          country?: string | null
          createdat?: string | null
          description?: string | null
          id?: string
          imageurl?: string | null
          ingredients?: string | null
          name: string
          owner_id?: string | null
          pvapercentage?: number | null
          pvastatus?: string | null
          type: string
          updatedat?: string | null
          videourl?: string | null
          websiteurl?: string | null
        }
        Update: {
          approved?: boolean | null
          brand?: string
          country?: string | null
          createdat?: string | null
          description?: string | null
          id?: string
          imageurl?: string | null
          ingredients?: string | null
          name?: string
          owner_id?: string | null
          pvapercentage?: number | null
          pvastatus?: string | null
          type?: string
          updatedat?: string | null
          videourl?: string | null
          websiteurl?: string | null
        }
        Relationships: []
      }
      product_supplier_links: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          product_title: string | null
          sku: string
          supplier_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          product_title?: string | null
          sku: string
          supplier_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          product_title?: string | null
          sku?: string
          supplier_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_supplier_links_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          id?: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          id: string
          updated_at: string | null
          username: string | null
          website: string | null
        }
        Insert: {
          avatar_url?: string | null
          full_name?: string | null
          id: string
          updated_at?: string | null
          username?: string | null
          website?: string | null
        }
        Update: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string | null
          username?: string | null
          website?: string | null
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          alibaba_order_id: string | null
          alibaba_order_uuid: string | null
          approval_token: string | null
          approved_at: string | null
          approved_by_email: string | null
          approved_by_name: string | null
          country: string
          created_at: string | null
          currency: string | null
          expires_at: string | null
          id: string
          line_items: Json | null
          notes: string | null
          payment_notes: string | null
          payment_status: string | null
          payment_verified_at: string | null
          payment_verified_by: string | null
          po_number: string
          sent_at: string | null
          status: string
          supplier_id: string | null
          supplier_notes: string | null
          terms: string | null
          total_amount: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          alibaba_order_id?: string | null
          alibaba_order_uuid?: string | null
          approval_token?: string | null
          approved_at?: string | null
          approved_by_email?: string | null
          approved_by_name?: string | null
          country?: string
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string
          line_items?: Json | null
          notes?: string | null
          payment_notes?: string | null
          payment_status?: string | null
          payment_verified_at?: string | null
          payment_verified_by?: string | null
          po_number: string
          sent_at?: string | null
          status?: string
          supplier_id?: string | null
          supplier_notes?: string | null
          terms?: string | null
          total_amount?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          alibaba_order_id?: string | null
          alibaba_order_uuid?: string | null
          approval_token?: string | null
          approved_at?: string | null
          approved_by_email?: string | null
          approved_by_name?: string | null
          country?: string
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string
          line_items?: Json | null
          notes?: string | null
          payment_notes?: string | null
          payment_status?: string | null
          payment_verified_at?: string | null
          payment_verified_by?: string | null
          po_number?: string
          sent_at?: string | null
          status?: string
          supplier_id?: string | null
          supplier_notes?: string | null
          terms?: string | null
          total_amount?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_alibaba_order_uuid_fkey"
            columns: ["alibaba_order_uuid"]
            isOneToOne: false
            referencedRelation: "alibaba_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      research_links: {
        Row: {
          created_at: string
          description: string
          id: string
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      settlement_lines: {
        Row: {
          accounting_category: string | null
          amount: number | null
          amount_description: string | null
          amount_type: string | null
          created_at: string | null
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
          created_at?: string | null
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
          created_at?: string | null
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
          created_at: string | null
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
          created_at?: string | null
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
          created_at?: string | null
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
          created_at: string | null
          currency: string | null
          deposit_date: string | null
          fba_fees: number | null
          gst_on_expenses: number | null
          gst_on_income: number | null
          id: string
          international_fees: number | null
          international_sales: number | null
          is_split_month: boolean | null
          marketplace: string
          net_ex_gst: number | null
          other_fees: number | null
          parser_version: string
          period_end: string | null
          period_start: string | null
          promotional_discounts: number | null
          reconciliation_status: string | null
          refunds: number | null
          reimbursements: number | null
          sales_principal: number | null
          sales_shipping: number | null
          seller_fees: number | null
          settlement_id: string
          split_month_1_data: Json | null
          split_month_1_end: string | null
          split_month_1_ratio: number | null
          split_month_1_start: string | null
          split_month_2_data: Json | null
          split_month_2_end: string | null
          split_month_2_ratio: number | null
          split_month_2_start: string | null
          split_rollover_amount: number | null
          status: string | null
          storage_fees: number | null
          updated_at: string | null
          user_id: string
          xero_journal_id: string | null
          xero_journal_id_1: string | null
          xero_journal_id_2: string | null
        }
        Insert: {
          bank_deposit?: number | null
          created_at?: string | null
          currency?: string | null
          deposit_date?: string | null
          fba_fees?: number | null
          gst_on_expenses?: number | null
          gst_on_income?: number | null
          id?: string
          international_fees?: number | null
          international_sales?: number | null
          is_split_month?: boolean | null
          marketplace?: string
          net_ex_gst?: number | null
          other_fees?: number | null
          parser_version?: string
          period_end?: string | null
          period_start?: string | null
          promotional_discounts?: number | null
          reconciliation_status?: string | null
          refunds?: number | null
          reimbursements?: number | null
          sales_principal?: number | null
          sales_shipping?: number | null
          seller_fees?: number | null
          settlement_id: string
          split_month_1_data?: Json | null
          split_month_1_end?: string | null
          split_month_1_ratio?: number | null
          split_month_1_start?: string | null
          split_month_2_data?: Json | null
          split_month_2_end?: string | null
          split_month_2_ratio?: number | null
          split_month_2_start?: string | null
          split_rollover_amount?: number | null
          status?: string | null
          storage_fees?: number | null
          updated_at?: string | null
          user_id: string
          xero_journal_id?: string | null
          xero_journal_id_1?: string | null
          xero_journal_id_2?: string | null
        }
        Update: {
          bank_deposit?: number | null
          created_at?: string | null
          currency?: string | null
          deposit_date?: string | null
          fba_fees?: number | null
          gst_on_expenses?: number | null
          gst_on_income?: number | null
          id?: string
          international_fees?: number | null
          international_sales?: number | null
          is_split_month?: boolean | null
          marketplace?: string
          net_ex_gst?: number | null
          other_fees?: number | null
          parser_version?: string
          period_end?: string | null
          period_start?: string | null
          promotional_discounts?: number | null
          reconciliation_status?: string | null
          refunds?: number | null
          reimbursements?: number | null
          sales_principal?: number | null
          sales_shipping?: number | null
          seller_fees?: number | null
          settlement_id?: string
          split_month_1_data?: Json | null
          split_month_1_end?: string | null
          split_month_1_ratio?: number | null
          split_month_1_start?: string | null
          split_month_2_data?: Json | null
          split_month_2_end?: string | null
          split_month_2_ratio?: number | null
          split_month_2_start?: string | null
          split_rollover_amount?: number | null
          status?: string | null
          storage_fees?: number | null
          updated_at?: string | null
          user_id?: string
          xero_journal_id?: string | null
          xero_journal_id_1?: string | null
          xero_journal_id_2?: string | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          address: string | null
          city: string | null
          company: string | null
          company_name: string | null
          contact_person: string | null
          country: string | null
          created_at: string
          email: string | null
          fax: string | null
          id: string
          mobile: string | null
          name: string
          notes: string | null
          phone: string | null
          postal_code: string | null
          province_region_state: string | null
          street: string | null
          supplier_date: string | null
          tax_id_number: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company?: string | null
          company_name?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          mobile?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          postal_code?: string | null
          province_region_state?: string | null
          street?: string | null
          supplier_date?: string | null
          tax_id_number?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company?: string | null
          company_name?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          mobile?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          postal_code?: string | null
          province_region_state?: string | null
          street?: string | null
          supplier_date?: string | null
          tax_id_number?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      uploaded_inventory_raw: {
        Row: {
          asin: string | null
          box_param_height: number | null
          box_param_length: number | null
          box_param_units_in_box: number | null
          box_param_width: number | null
          color: string | null
          comment: string | null
          created_at: string
          days_of_stock_left: number | null
          estimated_sales_velocity: number | null
          fba_buffer_days: number | null
          fba_fbm_stock: number | null
          fba_prep_stock_gold_coast: number | null
          fba_prep_stock_prep_center_2_stock: number | null
          fba_prep_stock_prep_center_3_stock: number | null
          fba_prep_stock_prep_center_4_stock: number | null
          fnsku: string | null
          historical_days_of_supply: number | null
          id: string
          item_number: string | null
          manuf_time_days: number | null
          margin: number | null
          marketplace: string | null
          missed_profit_est: number | null
          multipack_size: string | null
          ordered: number | null
          profit_forecast_30_days: number | null
          recommended_quantity_for_reordering: number | null
          recommended_ship_in_date_by_amazon: string | null
          recommended_ship_in_quantity_by_amazon: number | null
          reserved: number | null
          roi_percent: number | null
          running_out_of_stock: string | null
          sent_to_fba: number | null
          shipping_to_fba_days: number | null
          shipping_to_prep_center_days: number | null
          size: string | null
          sku: string
          stock_value: number | null
          supplier_contact: string | null
          supplier_name: string | null
          supplier_sku: string | null
          target_stock_range_after_new_order_days: number | null
          time_to_reorder: string | null
          title: string | null
          updated_at: string
          upload_id: string
          upload_session_name: string
          use_a_prep_center: string | null
          user_id: string
        }
        Insert: {
          asin?: string | null
          box_param_height?: number | null
          box_param_length?: number | null
          box_param_units_in_box?: number | null
          box_param_width?: number | null
          color?: string | null
          comment?: string | null
          created_at?: string
          days_of_stock_left?: number | null
          estimated_sales_velocity?: number | null
          fba_buffer_days?: number | null
          fba_fbm_stock?: number | null
          fba_prep_stock_gold_coast?: number | null
          fba_prep_stock_prep_center_2_stock?: number | null
          fba_prep_stock_prep_center_3_stock?: number | null
          fba_prep_stock_prep_center_4_stock?: number | null
          fnsku?: string | null
          historical_days_of_supply?: number | null
          id?: string
          item_number?: string | null
          manuf_time_days?: number | null
          margin?: number | null
          marketplace?: string | null
          missed_profit_est?: number | null
          multipack_size?: string | null
          ordered?: number | null
          profit_forecast_30_days?: number | null
          recommended_quantity_for_reordering?: number | null
          recommended_ship_in_date_by_amazon?: string | null
          recommended_ship_in_quantity_by_amazon?: number | null
          reserved?: number | null
          roi_percent?: number | null
          running_out_of_stock?: string | null
          sent_to_fba?: number | null
          shipping_to_fba_days?: number | null
          shipping_to_prep_center_days?: number | null
          size?: string | null
          sku: string
          stock_value?: number | null
          supplier_contact?: string | null
          supplier_name?: string | null
          supplier_sku?: string | null
          target_stock_range_after_new_order_days?: number | null
          time_to_reorder?: string | null
          title?: string | null
          updated_at?: string
          upload_id?: string
          upload_session_name: string
          use_a_prep_center?: string | null
          user_id: string
        }
        Update: {
          asin?: string | null
          box_param_height?: number | null
          box_param_length?: number | null
          box_param_units_in_box?: number | null
          box_param_width?: number | null
          color?: string | null
          comment?: string | null
          created_at?: string
          days_of_stock_left?: number | null
          estimated_sales_velocity?: number | null
          fba_buffer_days?: number | null
          fba_fbm_stock?: number | null
          fba_prep_stock_gold_coast?: number | null
          fba_prep_stock_prep_center_2_stock?: number | null
          fba_prep_stock_prep_center_3_stock?: number | null
          fba_prep_stock_prep_center_4_stock?: number | null
          fnsku?: string | null
          historical_days_of_supply?: number | null
          id?: string
          item_number?: string | null
          manuf_time_days?: number | null
          margin?: number | null
          marketplace?: string | null
          missed_profit_est?: number | null
          multipack_size?: string | null
          ordered?: number | null
          profit_forecast_30_days?: number | null
          recommended_quantity_for_reordering?: number | null
          recommended_ship_in_date_by_amazon?: string | null
          recommended_ship_in_quantity_by_amazon?: number | null
          reserved?: number | null
          roi_percent?: number | null
          running_out_of_stock?: string | null
          sent_to_fba?: number | null
          shipping_to_fba_days?: number | null
          shipping_to_prep_center_days?: number | null
          size?: string | null
          sku?: string
          stock_value?: number | null
          supplier_contact?: string | null
          supplier_name?: string | null
          supplier_sku?: string | null
          target_stock_range_after_new_order_days?: number | null
          time_to_reorder?: string | null
          title?: string | null
          updated_at?: string
          upload_id?: string
          upload_session_name?: string
          use_a_prep_center?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      video_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      videos: {
        Row: {
          category_id: string
          created_at: string
          description: string | null
          id: string
          thumbnail_url: string | null
          title: string
          updated_at: string
          youtube_id: string
          youtube_url: string
        }
        Insert: {
          category_id: string
          created_at?: string
          description?: string | null
          id?: string
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          youtube_id: string
          youtube_url: string
        }
        Update: {
          category_id?: string
          created_at?: string
          description?: string | null
          id?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          youtube_id?: string
          youtube_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "videos_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "video_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      where_to_buy_options: {
        Row: {
          benefits: string[] | null
          created_at: string
          description: string
          featured: boolean | null
          id: string
          name: string
          region: string
          type: string
          updated_at: string
          url: string
        }
        Insert: {
          benefits?: string[] | null
          created_at?: string
          description: string
          featured?: boolean | null
          id?: string
          name: string
          region: string
          type: string
          updated_at?: string
          url: string
        }
        Update: {
          benefits?: string[] | null
          created_at?: string
          description?: string
          featured?: boolean | null
          id?: string
          name?: string
          region?: string
          type?: string
          updated_at?: string
          url?: string
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
      amazon_product_mapping: {
        Row: {
          amazon_id: string | null
          amazon_images: Json | null
          amazon_title: string | null
          asin: string | null
          local_description: string | null
          local_id: string | null
          local_title: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_user_role: {
        Args: { role_name: string; user_uuid: string }
        Returns: boolean
      }
      extract_youtube_id: { Args: { youtube_url: string }; Returns: string }
      force_delete_product: { Args: { product_id: string }; Returns: boolean }
      has_role: { Args: { _role: string }; Returns: boolean }
      is_current_user_admin: { Args: never; Returns: boolean }
      is_primary_admin: { Args: never; Returns: boolean }
      now: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
