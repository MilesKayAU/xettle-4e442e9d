-- Add payment tracking fields to alibaba_orders table
ALTER TABLE public.alibaba_orders 
ADD COLUMN pay_date DATE,
ADD COLUMN payment_method TEXT DEFAULT 'AMEX GOLD',
ADD COLUMN amount_aud NUMERIC(10,2),
ADD COLUMN payment_notes TEXT;