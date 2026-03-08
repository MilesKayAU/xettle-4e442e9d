
-- Create a new table for data uploads with AI analysis
CREATE TABLE public.data_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  filename TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT NOT NULL, -- 'csv' or 'xlsx'
  upload_status TEXT NOT NULL DEFAULT 'processing', -- 'processing', 'completed', 'failed'
  raw_data JSONB, -- Store the parsed spreadsheet data
  ai_analysis JSONB, -- Store AI analysis results
  column_mapping JSONB, -- Store user-confirmed column mappings
  processed_data JSONB, -- Store cleaned/processed data
  insights JSONB, -- Store AI-generated insights
  error_message TEXT -- Store any error messages
);

-- Add Row Level Security
ALTER TABLE public.data_uploads ENABLE ROW LEVEL SECURITY;

-- Create policy for users to manage their own uploads
CREATE POLICY "Users can manage their own data uploads" 
  ON public.data_uploads 
  FOR ALL 
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_data_uploads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_data_uploads_updated_at
  BEFORE UPDATE ON public.data_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_data_uploads_updated_at();
