UPDATE public.marketplace_connections
SET connection_type = 'mirakl_api', updated_at = now()
WHERE marketplace_code = 'bunnings'
  AND connection_type = 'shopify_sub_channel'
  AND user_id IN (
    SELECT user_id FROM public.mirakl_tokens WHERE LOWER(marketplace_label) = 'bunnings'
  )