-- 044_whatsapp_shadow_users.sql
-- Maps WhatsApp sender JIDs to Member Market profiles.
-- A "shadow user" is a synthetic profile created for unlinked senders
-- so their bulletin_posts can be attributed and later claimed.

CREATE TABLE IF NOT EXISTS public.shadow_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  whatsapp_jid VARCHAR(255) UNIQUE NOT NULL,
  whatsapp_display_name VARCHAR(255),
  source_group_jid VARCHAR(255),
  source_chapter VARCHAR(100),
  email VARCHAR(255),
  linked_user_id UUID REFERENCES public.profiles(id),
  notify_via_whatsapp BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  linked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shadow_users_jid ON public.shadow_users(whatsapp_jid);
CREATE INDEX IF NOT EXISTS idx_shadow_users_email ON public.shadow_users(email);
CREATE INDEX IF NOT EXISTS idx_shadow_users_linked_user ON public.shadow_users(linked_user_id);

ALTER TABLE public.shadow_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access shadow_users"
  ON public.shadow_users FOR ALL
  USING (auth.role() = 'service_role');

-- Allow admins to read shadow users for the admin panel
CREATE POLICY "Admins read shadow_users"
  ON public.shadow_users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('chapter_admin', 'super_admin')
    )
  );

-- Mark profiles as shadow accounts so admin pages can filter them out.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_shadow BOOLEAN NOT NULL DEFAULT false;

-- Kill-switch: insert the whatsapp_agent_enabled flag into the existing feature_flags table.
-- Starts as false — admin must explicitly enable it.
INSERT INTO public.feature_flags (flag_name, is_enabled, description)
VALUES (
  'whatsapp_agent_enabled',
  false,
  'Master kill-switch for the WAHA WhatsApp integration. Set to true to enable processing of incoming messages.'
)
ON CONFLICT (flag_name) DO NOTHING;
