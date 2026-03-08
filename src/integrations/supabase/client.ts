
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Use environment variables for Supabase configuration
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export async function testSupabaseConnection() {
  try {
    console.log("Testing Supabase connection...");
    
    const { data, error } = await supabase.rpc('now');
    
    if (error) {
      console.error("Supabase connection test failed:", error);
      return {
        success: false,
        message: "Failed to connect to the database.",
        details: error
      };
    }
    
    const { data: tableData, error: tableError } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);
    
    if (tableError) {
      console.warn("Could connect to Supabase but couldn't read table data:", tableError);
      return {
        success: true,
        message: "Connected to database but couldn't read table data. This might indicate a permissions issue.",
        details: {
          timestamp: data,
          tableError
        }
      };
    }
    
    console.log("Supabase connection test successful:", { timestamp: data, tableTest: tableData });
    return {
      success: true,
      message: "Successfully connected to the database and verified read permissions.",
      details: {
        timestamp: data,
        tables: {
          profiles: tableData ? tableData.length : 0
        }
      }
    };
  } catch (e) {
    console.error("Unexpected error testing Supabase connection:", e);
    return {
      success: false,
      message: "An unexpected error occurred while testing the connection.",
      details: e
    };
  }
}

export interface ContactFormData {
  name: string;
  email: string;
  message: string;
}

export async function submitContactForm(formData: ContactFormData) {
  try {
    const { error } = await supabase
      .from('contact_messages')
      .insert({
        name: formData.name,
        email: formData.email,
        message: formData.message
      });

    if (error) {
      console.error("Error submitting contact form:", error);
      return {
        success: false,
        message: "Failed to submit contact form",
        error
      };
    }

    return {
      success: true,
      message: "Contact form submitted successfully"
    };
  } catch (error) {
    console.error("Exception in submitContactForm:", error);
    return {
      success: false,
      message: "An unexpected error occurred",
      error
    };
  }
}

export async function debugAuthStatus() {
  try {
    const { data: session, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error("Error getting session:", sessionError);
      return { authenticated: false, error: sessionError };
    }
    
    if (session && session.session) {
      console.log("User is authenticated:", session.session.user);
      return { authenticated: true, user: session.session.user };
    } else {
      console.log("No active session found");
      return { authenticated: false };
    }
  } catch (error) {
    console.error("Error in debugAuthStatus:", error);
    return { authenticated: false, error };
  }
}
