
-- Marketplace Fingerprint Library table
CREATE TABLE public.marketplace_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT NULL,
  marketplace_code text NOT NULL,
  field text NOT NULL CHECK (field IN ('note_attributes', 'tags', 'payment_method')),
  pattern text NOT NULL,
  confidence numeric NOT NULL DEFAULT 1.0,
  source text NOT NULL DEFAULT 'registry' CHECK (source IN ('registry', 'ai_detected', 'user_confirmed')),
  match_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(field, pattern)
);

-- RLS
ALTER TABLE public.marketplace_fingerprints ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read all fingerprints (global + own)
CREATE POLICY "Authenticated users can read fingerprints"
  ON public.marketplace_fingerprints FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

-- Users can insert their own fingerprints
CREATE POLICY "Users can insert own fingerprints"
  ON public.marketplace_fingerprints FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can update own; global patterns updatable by anyone (match_count increment)
CREATE POLICY "Users can update fingerprints"
  ON public.marketplace_fingerprints FOR UPDATE TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

-- Seed known AU marketplace patterns
INSERT INTO public.marketplace_fingerprints (user_id, marketplace_code, field, pattern, confidence, source, match_count) VALUES
  (NULL, 'mydeal', 'note_attributes', 'MyDealOrderID', 1.0, 'registry', 999),
  (NULL, 'bunnings', 'note_attributes', 'Order placed from: Bunnings', 1.0, 'registry', 999),
  (NULL, 'bunnings', 'note_attributes', 'Channel_id: 0196', 1.0, 'registry', 999),
  (NULL, 'bunnings', 'tags', 'mirakl', 0.95, 'registry', 999),
  (NULL, 'kogan', 'tags', 'kogan', 1.0, 'registry', 999),
  (NULL, 'kogan', 'payment_method', 'commercium by constacloud', 1.0, 'registry', 999),
  (NULL, 'bigw', 'tags', 'big w', 1.0, 'registry', 999),
  (NULL, 'everyday_market', 'note_attributes', 'Everyday Market', 1.0, 'registry', 999),
  (NULL, 'paypal', 'payment_method', 'paypal express checkout', 1.0, 'registry', 999),
  (NULL, 'afterpay', 'payment_method', 'afterpay', 1.0, 'registry', 999),
  (NULL, 'ebay', 'tags', 'EBAY', 0.95, 'registry', 999),
  (NULL, 'catch', 'note_attributes', 'CatchOrderID', 1.0, 'registry', 999);
