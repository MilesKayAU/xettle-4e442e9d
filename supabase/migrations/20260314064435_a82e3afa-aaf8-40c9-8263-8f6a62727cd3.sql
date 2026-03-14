ALTER TABLE settlement_components 
  ADD COLUMN IF NOT EXISTS components_used jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS formula_version text DEFAULT 'v1';