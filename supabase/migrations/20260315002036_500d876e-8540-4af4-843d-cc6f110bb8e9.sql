INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('audit-csvs', 'audit-csvs', false, 1048576, ARRAY['text/csv'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can read own audit CSVs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'audit-csvs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Service role can insert audit CSVs"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'audit-csvs');