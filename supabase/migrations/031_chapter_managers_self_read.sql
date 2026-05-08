-- ============================================================
-- 031_chapter_managers_self_read.sql
-- Members read their own chapter_managers assignments.
--
-- Migration 021 only had an admin-scoped policy, which broke two
-- downstream features for non-admin Chapter Managers:
--
--   1. The (app) layout's isChapterManager count returned 0 because
--      the user couldn't see their own row → "Chapter Manager Panel"
--      link never appeared in the navbar dropdown for pure-CM users.
--
--   2. chapter_endorsements has a policy "CMs read endorsements for
--      their chapter" gated on EXISTS (... chapter_managers ...).
--      That subquery is subject to chapter_managers RLS; without
--      this self-read policy a non-admin CM can't pass the EXISTS
--      check and the dashboard endorsement count shows 0.
--
-- Self-read only — this does NOT let members see other CMs of the
-- same chapter. The admin policy keeps full read for admins.
-- ============================================================

CREATE POLICY "Members read own chapter_manager assignments"
  ON public.chapter_managers FOR SELECT
  USING (auth.uid() = member_id);
