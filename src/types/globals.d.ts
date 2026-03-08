
interface Window {
  ENV_SUPABASE_URL?: string;
  ENV_SUPABASE_KEY?: string;
  validateSupabaseConfig?: () => {
    url: string;
    keyExists: boolean;
    timestamp: string;
    hostname: string;
  };
  generatedSitemap?: {
    xml: string;
    robots: string;
    routes: string[];
    timestamp: string;
  };
}
