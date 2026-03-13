CREATE POLICY "Users can delete their own settings"
ON public.app_settings
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);