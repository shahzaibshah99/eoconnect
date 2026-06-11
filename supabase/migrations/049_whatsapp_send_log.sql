-- 049_whatsapp_send_log.sql
-- Records every outbound WhatsApp DM so waha-client.ts can enforce send-rate
-- limits across serverless invocations (an in-memory queue won't persist on
-- Vercel). Two limits: max 1 DM per JID per 10s, and max 30 DMs/hour globally.

CREATE TABLE IF NOT EXISTS public.whatsapp_send_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  jid VARCHAR(255) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-JID recency lookups (the 10s window)
CREATE INDEX IF NOT EXISTS idx_whatsapp_send_log_jid_sent
  ON public.whatsapp_send_log (jid, sent_at DESC);

-- Global hourly-count lookups (the 30/hour window)
CREATE INDEX IF NOT EXISTS idx_whatsapp_send_log_sent
  ON public.whatsapp_send_log (sent_at DESC);

ALTER TABLE public.whatsapp_send_log ENABLE ROW LEVEL SECURITY;

-- Only the service role (server) touches this table.
CREATE POLICY "Service role full access whatsapp_send_log"
  ON public.whatsapp_send_log FOR ALL
  USING (auth.role() = 'service_role');

-- Test-phase guard: gates member match-emails for WhatsApp-sourced posts.
-- Starts FALSE so emails are SUPPRESSED during testing — matching still runs
-- and matched_business_ids are recorded, but no member is notified. Flip to
-- true (admin) to go live. Native website posts are unaffected.
INSERT INTO public.feature_flags (flag_name, is_enabled, description)
VALUES (
  'whatsapp_match_emails_enabled',
  false,
  'When true, WhatsApp-sourced bulletin posts email matched members (like native posts). When false (default), matching runs but member emails are suppressed — for the WhatsApp testing phase.'
)
ON CONFLICT (flag_name) DO NOTHING;
