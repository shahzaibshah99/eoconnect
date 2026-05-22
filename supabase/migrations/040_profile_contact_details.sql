ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS contact_visibility jsonb
    DEFAULT '{"email": false, "phone": false}'::jsonb NOT NULL;
