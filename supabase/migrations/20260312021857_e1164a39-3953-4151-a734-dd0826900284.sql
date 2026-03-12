ALTER TABLE public.xero_contact_account_mappings 
  ADD COLUMN original_contact_name text,
  ADD COLUMN normalised_contact_key text;

-- Backfill: set original_contact_name from contact_name, normalised_contact_key as lowercase trimmed
UPDATE public.xero_contact_account_mappings 
SET original_contact_name = contact_name,
    normalised_contact_key = lower(trim(contact_name));

-- Make normalised_contact_key NOT NULL after backfill
ALTER TABLE public.xero_contact_account_mappings 
  ALTER COLUMN normalised_contact_key SET NOT NULL;

-- Drop old unique constraint and create new one on normalised key
ALTER TABLE public.xero_contact_account_mappings 
  DROP CONSTRAINT IF EXISTS xero_contact_account_mappings_user_id_contact_name_account_c_key;

ALTER TABLE public.xero_contact_account_mappings 
  ADD CONSTRAINT xero_contact_account_mappings_user_normalised_account_key 
  UNIQUE (user_id, normalised_contact_key, account_code);