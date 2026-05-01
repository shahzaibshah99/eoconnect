-- ============================================================
-- 020_profile_notifications_seen_at.sql
-- Track when each member last viewed their notifications.
--
-- The navbar's notifications bell counts reviews left on the
-- member's businesses since this timestamp. Clicking the bell
-- (or the "Mark all as read" action inside the dropdown) bumps
-- it to now() so the badge clears.
--
-- Default is now() rather than null because:
--   - Setting it null would mean every existing review on a
--     member's listing counts as "unread" for them on first
--     load — noisy.
--   - now() means existing members start with a clean slate
--     and only see notifications for reviews submitted from
--     this point forward.
-- ============================================================

alter table public.profiles
  add column if not exists notifications_seen_at timestamptz not null default now();
