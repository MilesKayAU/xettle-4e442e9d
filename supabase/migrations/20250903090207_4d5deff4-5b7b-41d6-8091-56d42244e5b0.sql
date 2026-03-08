-- Make order_url nullable since it's not always relevant for invoices
ALTER TABLE public.alibaba_orders ALTER COLUMN order_url DROP NOT NULL;