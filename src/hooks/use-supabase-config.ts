
import { useState, useEffect } from 'react';

interface SupabaseConfig {
  url: string;
  key: string;
  isCustom: boolean;
}

// Hardcoded fallback values as last resort
const FALLBACK_URL = "https://wtxqdzcihxjaiosmffvm.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0eHFkemNpaHhqYWlvc21mZnZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyMTMxNjcsImV4cCI6MjA1ODc4OTE2N30.1PCe3yo5Xscz-lKBU6lI9iv7Pu8KcLQwPc8mMCfqK_Y";

/**
 * Custom hook that retrieves Supabase configuration from environment or defaults
 * This unifies the configuration logic across components with multiple fallbacks
 */
export function useSupabaseConfig(): SupabaseConfig {
  const [config, setConfig] = useState<SupabaseConfig>({
    url: FALLBACK_URL,
    key: FALLBACK_KEY,
    isCustom: false
  });

  useEffect(() => {
    // Check for environment variables with detailed logging
    const checkConfiguration = () => {
      if (typeof window === 'undefined') {
        console.log("[SupabaseConfig] Window object not available yet");
        return false;
      }
      
      console.log("[SupabaseConfig] Checking for Supabase configuration...");
      
      // First check for inline config in HTML
      const envUrl = window.ENV_SUPABASE_URL;
      const envKey = window.ENV_SUPABASE_KEY;
      
      console.log("[SupabaseConfig] Environment variables check:");
      console.log("- ENV_SUPABASE_URL exists:", !!envUrl);
      console.log("- ENV_SUPABASE_KEY exists:", !!envKey);
      
      if (envUrl && envKey) {
        console.log("[SupabaseConfig] ✅ Using configuration from environment variables");
        console.log("- URL:", envUrl);
        
        setConfig({
          url: envUrl,
          key: envKey,
          isCustom: true
        });
        return true;
      }
      
      // Check if validate function exists (indicating inline config is loaded)
      if (typeof window.validateSupabaseConfig === 'function') {
        try {
          const validationResult = window.validateSupabaseConfig();
          console.log("[SupabaseConfig] Validation result:", validationResult);
          
          if (validationResult.url && validationResult.keyExists) {
            console.log("[SupabaseConfig] ✅ Using validated configuration");
            return true;
          }
        } catch (e) {
          console.error("[SupabaseConfig] Error validating config:", e);
        }
      }
      
      console.log("[SupabaseConfig] ⚠️ Using fallback configuration - no environment variables found");
      
      // Warning for production domain
      if (window.location.hostname.includes('mileskay.com.au')) {
        console.warn("[SupabaseConfig] 🚨 Running on production domain with fallback configuration!");
      }
      
      return false;
    };
    
    // Initial check
    const configFound = checkConfiguration();
    
    // If no config found immediately, set up a retry mechanism
    if (!configFound) {
      // Try again after a short delay in case the script loads late
      const retryTimeout = setTimeout(() => {
        console.log("[SupabaseConfig] Retrying configuration check...");
        checkConfiguration();
      }, 1000);
      
      return () => clearTimeout(retryTimeout);
    }
  }, []);

  return config;
}

/**
 * Custom hook to access the OpenAI API key that's shared across the application
 * This ensures all AI features use the same key configuration
 */
export function useOpenAiKey(): {
  apiKey: string;
  setApiKey: (key: string) => void;
  isLoaded: boolean;
} {
  const [apiKey, setApiKeyState] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  
  useEffect(() => {
    try {
      // Load from localStorage
      const storedKey = localStorage.getItem('openai_api_key');
      if (storedKey) {
        setApiKeyState(storedKey);
        console.log("[OpenAI] API key loaded from localStorage");
      } else {
        console.log("[OpenAI] No API key found in localStorage");
      }
      setIsLoaded(true);
    } catch (error) {
      console.error("[OpenAI] Error accessing localStorage:", error);
      setIsLoaded(true);
    }
  }, []);
  
  const setApiKey = (key: string) => {
    try {
      // Save to localStorage
      localStorage.setItem('openai_api_key', key);
      setApiKeyState(key);
      console.log("[OpenAI] API key saved to localStorage");
    } catch (error) {
      console.error("[OpenAI] Error saving to localStorage:", error);
    }
  };
  
  return { apiKey, setApiKey, isLoaded };
}
