-- Create table for ignored products
CREATE TABLE public.ignored_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sku TEXT NOT NULL,
  ignore_type TEXT NOT NULL CHECK (ignore_type IN ('permanent', 'upload')),
  upload_id UUID NULL, -- Only used for upload-specific ignores
  reason TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique constraint separately to handle the COALESCE properly
CREATE UNIQUE INDEX idx_ignored_products_unique 
ON public.ignored_products (user_id, sku, ignore_type, COALESCE(upload_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Enable Row Level Security
ALTER TABLE public.ignored_products ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can manage their own ignored products" 
ON public.ignored_products 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_ignored_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_ignored_products_updated_at
BEFORE UPDATE ON public.ignored_products
FOR EACH ROW
EXECUTE FUNCTION public.update_ignored_products_updated_at();