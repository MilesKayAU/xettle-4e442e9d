-- Insert default notification email if not exists
INSERT INTO app_settings (key, value)
VALUES ('notification_email', 'mileskayaustralia@gmail.com')
ON CONFLICT (key) DO NOTHING;