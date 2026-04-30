-- ============================================================
-- 014_business_pause_provenance.sql
-- Track WHO paused a listing so admin pauses can't be overridden
-- by the owner.
--
-- Background: members can pause/resume their own listings, and
-- admins (chapter_admin / super_admin) can pause member listings
-- as a moderation tool. Without recording provenance, the moment
-- a member set their own listing back to 'published', they
-- effectively unpaused an admin's moderation action — defeating
-- the whole point of admin pause.
--
-- Design: a single nullable column `paused_by` records the actor
-- when status='paused'. Values:
--   null   → not paused (status will be 'draft' or 'published')
--   'owner'→ paused by the listing owner
--   'admin'→ paused by chapter_admin or super_admin
--
-- The application logic (actions/business.ts updateBusinessStatus
-- and actions/admin.ts setBusinessStatusAdmin) enforces the rule
-- that members cannot resume an admin pause. The DB just stores
-- the fact.
--
-- Existing 'paused' rows are migrated to paused_by='admin' on the
-- assumption that current pauses came from moderation — there's
-- no member-facing pause control today, so all pauses to date
-- were admin-initiated. This is the conservative default: better
-- to require an admin to unpause an existing pause than silently
-- give the owner override they never had before.
-- ============================================================

alter table public.businesses
  add column if not exists paused_by text
    check (paused_by in ('owner', 'admin'));

-- Backfill any currently-paused rows as admin pauses.
update public.businesses
   set paused_by = 'admin'
 where status = 'paused'
   and paused_by is null;

-- Sanity: when status leaves 'paused', paused_by must be cleared.
-- Enforced in application code; we don't add a CHECK constraint
-- because doing so would require a multi-statement transition
-- (clear paused_by + change status) that complicates simple
-- UPDATE status='published' calls. Instead we trust the actions
-- to clear it on transition.
