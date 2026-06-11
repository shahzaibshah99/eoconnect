-- 045_needs_leads.sql
-- Extends bulletin_posts to support WhatsApp-sourced entries.
-- NOTE: There is no separate needs_leads table — the existing bulletin_posts
-- table is the canonical store. This migration adds WhatsApp metadata columns.

ALTER TABLE public.bulletin_posts
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS shadow_user_id UUID REFERENCES public.shadow_users(id),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS bulletin_posts_expires_at_idx
  ON public.bulletin_posts (expires_at)
  WHERE status = 'open' AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS bulletin_posts_source_idx
  ON public.bulletin_posts (source)
  WHERE source IS NOT NULL;
