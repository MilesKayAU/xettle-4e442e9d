import { Database as OriginalDatabase } from '@/integrations/supabase/types';

// Extend the original Database type to include newsletter_subscribers and contact_messages tables
export type Database = OriginalDatabase & {
  public: {
    Tables: {
      newsletter_subscribers: {
        Row: {
          id: string;
          email: string;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      contact_messages: {
        Row: {
          id: string;
          name: string;
          email: string;
          message: string;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          email: string;
          message: string;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          message?: string;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
    } & OriginalDatabase['public']['Tables'];
    Views: OriginalDatabase['public']['Views'];
    Functions: OriginalDatabase['public']['Functions'];
    Enums: OriginalDatabase['public']['Enums'];
    CompositeTypes: OriginalDatabase['public']['CompositeTypes'];
  };
};

// Create a typed supabase client helper
import { createClient } from '@supabase/supabase-js';

// Create and export the extended Supabase client
export const createTypedSupabaseClient = (url: string, key: string) => 
  createClient<Database>(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    global: {
      headers: {
        'X-Client-Info': 'lovable-app',
      },
    },
  });

export type TypedSupabaseClient = ReturnType<typeof createTypedSupabaseClient>;
