-- Create shipping cost estimates table
CREATE TABLE public.marketplace_shipping_costs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    marketplace_code TEXT NOT NULL,
    cost_per_order NUMERIC NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'AUD',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, marketplace_code)
);

-- Enable RLS
ALTER TABLE public.marketplace_shipping_costs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own shipping costs"
ON public.marketplace_shipping_costs
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own shipping costs"
ON public.marketplace_shipping_costs
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own shipping costs"
ON public.marketplace_shipping_costs
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own shipping costs"
ON public.marketplace_shipping_costs
FOR DELETE
USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_marketplace_shipping_costs_updated_at
BEFORE UPDATE ON public.marketplace_shipping_costs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();