-- Add country column to alibaba_orders table
ALTER TABLE public.alibaba_orders 
ADD COLUMN country text DEFAULT 'Australia';

-- Update existing records to have Australia as default
UPDATE public.alibaba_orders 
SET country = 'Australia' 
WHERE country IS NULL;