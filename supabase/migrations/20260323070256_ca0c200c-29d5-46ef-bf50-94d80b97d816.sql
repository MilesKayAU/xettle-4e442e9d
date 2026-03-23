UPDATE public.marketplace_connections
SET connection_type = 'mirakl_api'
WHERE marketplace_code = 'bunnings'
  AND connection_type = 'shopify_sub_channel'
  AND EXISTS (
    SELECT 1 FROM public.mirakl_tokens mt
    WHERE mt.user_id = marketplace_connections.user_id
    AND LOWER(mt.marketplace_label) = 'bunnings'
  )