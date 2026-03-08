-- Fix remaining functions with search_path issues
CREATE OR REPLACE FUNCTION public.before_insert_update_video()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Extract YouTube ID
  NEW.youtube_id := public.extract_youtube_id(NEW.youtube_url);
  
  -- Set thumbnail URL if not provided
  IF NEW.thumbnail_url IS NULL OR NEW.thumbnail_url = '' THEN
    NEW.thumbnail_url := 'https://img.youtube.com/vi/' || NEW.youtube_id || '/mqdefault.jpg';
  END IF;
  
  -- Update updated_at
  NEW.updated_at := now();
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.extract_youtube_id(youtube_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  youtube_id TEXT;
BEGIN
  -- Extract YouTube ID from different URL formats
  IF youtube_url ~ 'youtube\.com\/watch\?v=' THEN
    youtube_id := substring(youtube_url from 'v=([^&]*)');
  ELSIF youtube_url ~ 'youtu\.be\/' THEN
    youtube_id := substring(youtube_url from 'youtu\.be\/([^?]*)');
  ELSIF youtube_url ~ 'youtube\.com\/embed\/' THEN
    youtube_id := substring(youtube_url from 'embed\/([^?]*)');
  ELSE
    youtube_id := youtube_url;
  END IF;

  RETURN youtube_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.now()
RETURNS timestamp with time zone
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT now();
$function$;