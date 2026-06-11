-- 047_whatsapp_classification_log.sql
-- Audit log for every Claude classification decision — used for
-- observability, cost tracking, and classifier tuning.

CREATE TABLE IF NOT EXISTS public.whatsapp_classification_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  waha_message_id TEXT NOT NULL,
  message_text TEXT,
  intent TEXT NOT NULL,
  confidence NUMERIC(4,3),
  sensitive BOOLEAN NOT NULL DEFAULT false,
  dropped BOOLEAN NOT NULL DEFAULT false,
  post_id UUID REFERENCES public.bulletin_posts(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Dedup guard: WAHA may deliver the same message more than once.
ALTER TABLE public.whatsapp_classification_log
  ADD CONSTRAINT whatsapp_classification_log_waha_message_id_key
  UNIQUE (waha_message_id);

CREATE INDEX IF NOT EXISTS wa_classification_log_created_idx
  ON public.whatsapp_classification_log (created_at DESC);

CREATE INDEX IF NOT EXISTS wa_classification_log_intent_idx
  ON public.whatsapp_classification_log (intent, created_at DESC);

ALTER TABLE public.whatsapp_classification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access classification_log"
  ON public.whatsapp_classification_log FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Admins read classification log"
  ON public.whatsapp_classification_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('chapter_admin', 'super_admin')
    )
  );
