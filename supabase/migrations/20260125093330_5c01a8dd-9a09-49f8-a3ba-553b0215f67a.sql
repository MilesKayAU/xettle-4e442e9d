-- Create xero_tokens table to store OAuth tokens per user
CREATE TABLE public.xero_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  scope TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, tenant_id)
);

-- Enable Row Level Security
ALTER TABLE public.xero_tokens ENABLE ROW LEVEL SECURITY;

-- Create policies for user access (only admins can manage tokens)
CREATE POLICY "Admins can view xero tokens" 
ON public.xero_tokens 
FOR SELECT 
USING (public.is_current_user_admin());

CREATE POLICY "Admins can insert xero tokens" 
ON public.xero_tokens 
FOR INSERT 
WITH CHECK (public.is_current_user_admin());

CREATE POLICY "Admins can update xero tokens" 
ON public.xero_tokens 
FOR UPDATE 
USING (public.is_current_user_admin());

CREATE POLICY "Admins can delete xero tokens" 
ON public.xero_tokens 
FOR DELETE 
USING (public.is_current_user_admin());

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_xero_tokens_updated_at
BEFORE UPDATE ON public.xero_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();