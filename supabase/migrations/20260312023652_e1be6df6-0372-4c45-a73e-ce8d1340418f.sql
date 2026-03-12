-- Backfill normalised_contact_key for existing rows where it is NULL
UPDATE public.xero_contact_account_mappings
SET normalised_contact_key = lower(trim(contact_name))
WHERE normalised_contact_key IS NULL;

-- Now enforce NOT NULL
ALTER TABLE public.xero_contact_account_mappings
ALTER COLUMN normalised_contact_key SET NOT NULL;