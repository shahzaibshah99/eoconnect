-- 048_whatsapp_dm_state.sql
-- State machine for WhatsApp DM conversations (link-account flow).
-- One row per JID, upserted on each DM event.

CREATE TABLE IF NOT EXISTS public.whatsapp_dm_state (
  jid VARCHAR(255) PRIMARY KEY,
  state VARCHAR(50) DEFAULT 'awaiting_reply',
  last_post_id UUID,
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE public.whatsapp_dm_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access whatsapp_dm_state"
  ON public.whatsapp_dm_state FOR ALL
  USING (auth.role() = 'service_role');
