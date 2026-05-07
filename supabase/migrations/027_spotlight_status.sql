-- ============================================================
-- 027_spotlight_status.sql
-- Adds approval status to spotlight_schedule so Chapter Manager
-- nominations can sit in 'pending' until App Admin approves.
--
-- Per scope F19 + F15: "Approve Chapter Manager nominations
-- (status column needed on the table — currently lacks one)".
-- ============================================================

ALTER TABLE public.spotlight_schedule
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE public.spotlight_schedule
  ADD COLUMN IF NOT EXISTS nominated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.spotlight_schedule
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE INDEX IF NOT EXISTS spotlight_schedule_pending_idx
  ON public.spotlight_schedule (status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS spotlight_schedule_month_idx
  ON public.spotlight_schedule (month);
