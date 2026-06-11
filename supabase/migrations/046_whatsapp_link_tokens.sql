-- 046_whatsapp_link_tokens.sql
-- Short-lived tokens sent via WhatsApp DM to allow unlinked senders
-- to authenticate and bind their WhatsApp JID to their real profile.

CREATE TABLE IF NOT EXISTS public.whatsapp_link_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token VARCHAR(64) UNIQUE NOT NULL,
  shadow_user_id UUID REFERENCES public.shadow_users(id) NOT NULL,
  target_email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  consumed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_link_tokens_token ON public.whatsapp_link_tokens(token);
CREATE INDEX IF NOT EXISTS idx_whatsapp_link_tokens_shadow ON public.whatsapp_link_tokens(shadow_user_id);

ALTER TABLE public.whatsapp_link_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access whatsapp_link_tokens"
  ON public.whatsapp_link_tokens FOR ALL
  USING (auth.role() = 'service_role');
