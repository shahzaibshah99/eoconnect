-- ============================================================
-- 025_csv_imports.sql
-- CSV import queue. App Admin uploads land directly with
-- source='admin'; Chapter Manager submissions land with
-- source='chapter_manager' status='pending' awaiting review.
--
-- Payload is jsonb — captures the parsed rows verbatim. Actual
-- profile/business row creation is deferred until claim flow
-- exists (businesses.owner_id is NOT NULL — can't pre-create).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.csv_imports (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  chapter_id bigint REFERENCES public.eo_chapters(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('admin', 'chapter_manager')),
  payload jsonb NOT NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'processed')),
  rejection_reason text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  processed_at timestamptz,
  tenant_id text NOT NULL DEFAULT 'eo',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.csv_imports ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write the queue. Chapter manager submissions
-- come in via a server action under service-role.
CREATE POLICY "Admins manage csv_imports"
  ON public.csv_imports FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('chapter_admin', 'super_admin')
    )
  );

CREATE INDEX IF NOT EXISTS csv_imports_status_pending_idx
  ON public.csv_imports (status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS csv_imports_tenant_idx
  ON public.csv_imports (tenant_id);

CREATE INDEX IF NOT EXISTS csv_imports_chapter_idx
  ON public.csv_imports (chapter_id);
