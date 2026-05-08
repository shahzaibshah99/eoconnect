-- ============================================================
-- 030_notifications_and_suspension.sql
-- Two related additions per marketing-lead feedback:
--
--   1. General-purpose notifications table — verification approval /
--      rejection / resubmit events surface in the navbar bell.
--
--   2. profiles.suspension_reason — when a verification is rejected
--      the member's account auto-suspends and the reason is shown
--      on the /suspended page.
-- ============================================================

-- 1. General-purpose notifications.
--
-- Existing review notifications still flow through the layout's
-- review-table query — this table covers everything else (verification
-- status changes, future flag dispositions, etc.).
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  -- Where clicking the notification should take the user. Relative path
  -- (e.g. /dashboard/verify) — the navbar prepends nothing.
  link text,
  -- Per-row read marker. Bell currently uses profiles.notifications_seen_at
  -- as the bulk "mark all read" timestamp; this column is here for future
  -- per-row dismissal without changing the schema later.
  read_at timestamptz,
  tenant_id text NOT NULL DEFAULT 'eo',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Members read their own notifications.
CREATE POLICY "Members read own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Members can mark-read (update read_at) on their own rows. Server
-- actions bypass RLS via service-role for inserts.
CREATE POLICY "Members mark own notifications read"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_tenant_idx
  ON public.notifications (tenant_id);

-- 2. Suspension reason on profiles. Set when admin rejects a
--    verification (which auto-suspends); rendered on /suspended page.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspension_reason text;
