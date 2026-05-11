-- ============================================================
-- 032_terms_acceptance.sql
-- Per scope F06: "First login → cannot skip. Non-solicitation
-- terms explicit. Acceptance timestamped on account. Re-shown
-- on terms update."
--
-- profiles.terms_accepted_at — when they accepted.
-- profiles.terms_version    — which version they accepted.
--   NULL on both = has never accepted → show T&C wall.
--   terms_version < CURRENT_TERMS_VERSION → re-show.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version integer;

CREATE INDEX IF NOT EXISTS profiles_terms_pending_idx
  ON public.profiles (id)
  WHERE terms_accepted_at IS NULL;
