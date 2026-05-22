ALTER TABLE public.bulletin_posts
  ADD COLUMN IF NOT EXISTS ai_tagline text;
