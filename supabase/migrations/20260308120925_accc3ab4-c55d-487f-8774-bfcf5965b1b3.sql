-- Enable pg_net extension if not already enabled (needed for cron HTTP calls)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;