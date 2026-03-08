-- Add Hamilton Smith Pty demo supplier for Xero testing
INSERT INTO public.invoice_suppliers (name, contact_name, email) VALUES 
('Hamilton Smith Pty', 'Hamilton Smith', 'infodemo@hsmithdemo.co')
ON CONFLICT (name) DO UPDATE SET
  contact_name = EXCLUDED.contact_name,
  email = EXCLUDED.email;