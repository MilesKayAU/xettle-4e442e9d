-- Add additional fields to suppliers table to support comprehensive supplier information
ALTER TABLE public.suppliers 
ADD COLUMN IF NOT EXISTS company text,
ADD COLUMN IF NOT EXISTS mobile text,
ADD COLUMN IF NOT EXISTS fax text,
ADD COLUMN IF NOT EXISTS website text,
ADD COLUMN IF NOT EXISTS street text,
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS province_region_state text,
ADD COLUMN IF NOT EXISTS postal_code text,
ADD COLUMN IF NOT EXISTS country text,
ADD COLUMN IF NOT EXISTS supplier_date date,
ADD COLUMN IF NOT EXISTS tax_id_number text;

-- Update the name column to allow it to be the contact person name
ALTER TABLE public.suppliers 
ADD COLUMN IF NOT EXISTS company_name text;

-- Update existing records to move name to contact_person if needed
UPDATE public.suppliers 
SET contact_person = name, company_name = name 
WHERE contact_person IS NULL AND company_name IS NULL;