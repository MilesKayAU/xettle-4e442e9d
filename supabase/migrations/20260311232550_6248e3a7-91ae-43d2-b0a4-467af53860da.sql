-- User-level contact classifications (private per user)
CREATE TABLE public.user_contact_classifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  contact_name TEXT NOT NULL,
  classification TEXT NOT NULL, -- 'marketplace', 'business_expense', 'personal', 'skip'
  category TEXT, -- subcategory: 'travel', 'parking', 'freight', 'advertising', 'subscriptions', 'other'
  notes TEXT,
  xero_contact_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, contact_name)
);

ALTER TABLE public.user_contact_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own contact classifications"
  ON public.user_contact_classifications FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_user_contact_classifications_updated_at
  BEFORE UPDATE ON public.user_contact_classifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Community (anonymised) contact classifications with vote counts
CREATE TABLE public.community_contact_classifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_name TEXT NOT NULL,
  classification TEXT NOT NULL, -- 'marketplace', 'business_expense', 'personal'
  category TEXT, -- subcategory
  vote_count INTEGER NOT NULL DEFAULT 1,
  confidence_pct NUMERIC DEFAULT 0,
  last_voted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(contact_name, classification, category)
);

ALTER TABLE public.community_contact_classifications ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read community classifications
CREATE POLICY "Authenticated users can read community classifications"
  ON public.community_contact_classifications FOR SELECT
  TO authenticated
  USING (true);

-- Only allow inserts/updates via server-side (service role) to prevent gaming
-- Users contribute through user_contact_classifications, which triggers community update

-- Function to update community classifications when a user classifies a contact
CREATE OR REPLACE FUNCTION public.sync_community_classification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Upsert into community table (increment vote)
  INSERT INTO public.community_contact_classifications (contact_name, classification, category, vote_count, last_voted_at)
  VALUES (LOWER(TRIM(NEW.contact_name)), NEW.classification, NEW.category, 1, now())
  ON CONFLICT (contact_name, classification, category)
  DO UPDATE SET
    vote_count = community_contact_classifications.vote_count + 1,
    last_voted_at = now();

  -- Recalculate confidence for this contact_name
  UPDATE public.community_contact_classifications
  SET confidence_pct = ROUND(
    vote_count::NUMERIC / NULLIF((
      SELECT SUM(vote_count) FROM public.community_contact_classifications
      WHERE contact_name = LOWER(TRIM(NEW.contact_name))
    ), 0) * 100, 0
  )
  WHERE contact_name = LOWER(TRIM(NEW.contact_name));

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_community_on_user_classification
  AFTER INSERT ON public.user_contact_classifications
  FOR EACH ROW EXECUTE FUNCTION public.sync_community_classification();