ALTER TABLE channel_alerts
  ADD COLUMN IF NOT EXISTS detection_method text DEFAULT 'source_name',
  ADD COLUMN IF NOT EXISTS detected_label text,
  ADD COLUMN IF NOT EXISTS candidate_tags jsonb DEFAULT '[]'::jsonb;