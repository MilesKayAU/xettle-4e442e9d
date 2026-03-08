-- Create Alibaba orders table
CREATE TABLE public.alibaba_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  order_url TEXT NOT NULL,
  order_id TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT
);

-- Enable Row Level Security
ALTER TABLE public.alibaba_orders ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated admin users
CREATE POLICY "Authenticated users can manage alibaba orders" 
ON public.alibaba_orders 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_alibaba_orders_updated_at
BEFORE UPDATE ON public.alibaba_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();