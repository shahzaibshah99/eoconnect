-- ============================================================
-- 026_flags.sql
-- Member-reported flags on listings, posts, threads, reviews,
-- messages. Per scope F06: 4 types, 3-flag auto-escalation,
-- admin queue with warn/suspend/ban actions.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.flags (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  target_type text NOT NULL
    CHECK (target_type IN ('listing', 'post', 'response', 'review', 'message')),
  -- Polymorphic target — no FK constraint because target_type spans
  -- multiple tables. Cleanup happens via the resolve flow when the
  -- underlying record is deleted.
  target_id uuid NOT NULL,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL
    CHECK (type IN ('solicitation', 'spam', 'inaccurate', 'inappropriate')),
  reason text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'dismissed', 'warned', 'suspended', 'banned')),
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  tenant_id text NOT NULL DEFAULT 'eo',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can submit flags"
  ON public.flags FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Members can view their own flags"
  ON public.flags FOR SELECT
  USING (auth.uid() = reporter_id);

CREATE POLICY "Admins can manage flags"
  ON public.flags FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('chapter_admin', 'super_admin')
    )
  );

CREATE INDEX IF NOT EXISTS flags_status_open_idx
  ON public.flags (status)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS flags_target_idx
  ON public.flags (target_type, target_id);

CREATE INDEX IF NOT EXISTS flags_tenant_idx
  ON public.flags (tenant_id);

CREATE INDEX IF NOT EXISTS flags_reporter_idx
  ON public.flags (reporter_id);

-- Helper: count of open flags per target. Used by the admin queue to
-- surface 3+ flag auto-escalation visually.
CREATE OR REPLACE VIEW public.flags_target_summary AS
SELECT
  target_type,
  target_id,
  COUNT(*) FILTER (WHERE status = 'open') AS open_count,
  COUNT(*) AS total_count,
  MAX(created_at) FILTER (WHERE status = 'open') AS latest_open_at,
  array_agg(DISTINCT type) FILTER (WHERE status = 'open') AS open_types
FROM public.flags
GROUP BY target_type, target_id;
