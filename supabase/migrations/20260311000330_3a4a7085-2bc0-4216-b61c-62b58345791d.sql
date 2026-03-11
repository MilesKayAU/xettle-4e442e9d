ALTER TABLE public.channel_alerts
  ADD COLUMN IF NOT EXISTS alert_type text DEFAULT 'new';

COMMENT ON COLUMN public.channel_alerts.alert_type IS 'Alert type: new (never seen), unlinked (marketplace exists but not linked to Shopify orders), already_linked (skip)';

-- Update existing MyDeal and Bunnings alerts to unlinked if those marketplaces have settlements
UPDATE public.channel_alerts ca
SET alert_type = 'unlinked'
WHERE ca.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.settlements s
    WHERE s.user_id = ca.user_id
      AND lower(s.marketplace) = lower(ca.detected_label)
  );