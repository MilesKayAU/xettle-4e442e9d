-- Copy-forward migration: duplicate legacy payout_account:* into payout_destination:*
-- Does NOT delete or rename legacy keys. Normalises rail codes via alias map.

-- Step 1: Copy _default key if new key doesn't exist yet
INSERT INTO public.app_settings (user_id, key, value, created_at, updated_at)
SELECT
  user_id,
  'payout_destination:_default',
  value,
  now(),
  now()
FROM public.app_settings
WHERE key = 'payout_account:_default'
  AND value IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.app_settings AS existing
    WHERE existing.user_id = app_settings.user_id
      AND existing.key = 'payout_destination:_default'
  );

-- Step 2: Copy marketplace-specific keys, normalising ebay_au → ebay
INSERT INTO public.app_settings (user_id, key, value, created_at, updated_at)
SELECT
  user_id,
  'payout_destination:' || CASE
    WHEN REPLACE(key, 'payout_account:', '') = 'ebay_au' THEN 'ebay'
    ELSE REPLACE(key, 'payout_account:', '')
  END,
  value,
  now(),
  now()
FROM public.app_settings
WHERE key LIKE 'payout_account:%'
  AND key != 'payout_account:_default'
  AND value IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.app_settings AS existing
    WHERE existing.user_id = app_settings.user_id
      AND existing.key = 'payout_destination:' || CASE
        WHEN REPLACE(app_settings.key, 'payout_account:', '') = 'ebay_au' THEN 'ebay'
        ELSE REPLACE(app_settings.key, 'payout_account:', '')
      END
  );