-- ============================================================
-- 029_pre_populated_listings.sql
-- Allow business listings to exist BEFORE a member claims them.
--
-- Per scope F03: pre-populated listings are seeded by App Admin
-- (or Chapter Manager) via CSV import or one-off form. They sit
-- in the marketplace as "Unverified" until the real owner claims
-- via a magic link emailed to their business address.
--
-- The schema-shape for claim was already added in migration 020:
--   businesses.is_pre_populated, claim_token, claim_token_expires_at,
--   claim_email_sent_at, claim_email_count, claimed_at
--
-- The remaining gap is owner_id NOT NULL — pre-populated rows
-- can't have an owner yet. This migration drops the NOT NULL
-- constraint AND adds a partial check to keep claimed listings
-- owner-required.
-- ============================================================

-- 1. Drop NOT NULL on owner_id
ALTER TABLE public.businesses
  ALTER COLUMN owner_id DROP NOT NULL;

-- 2. Constrain: claimed listings (claimed_at IS NOT NULL) must have an owner.
--    Pre-populated unclaimed listings can have null owner_id.
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_claimed_must_have_owner;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_claimed_must_have_owner CHECK (
    claimed_at IS NULL OR owner_id IS NOT NULL
  );

-- 3. Pre-populated listings without a claim_token are useless. Add a
--    check so an admin can't accidentally create one without it.
--    (claim_token unique constraint already exists from migration 020.)
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_pre_pop_needs_token;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_pre_pop_needs_token CHECK (
    is_pre_populated = false OR claim_token IS NOT NULL
  );

-- 4. Pre-populated listings reference an `email` for the eventual
--    claimer to match against. The businesses.email column exists
--    already; just ensure it's indexed for fast claim-by-email lookup.
CREATE INDEX IF NOT EXISTS businesses_email_idx
  ON public.businesses (lower(email))
  WHERE email IS NOT NULL;

-- 5. Quick lookup of unclaimed listings — admin queue UI uses this.
CREATE INDEX IF NOT EXISTS businesses_unclaimed_idx
  ON public.businesses (is_pre_populated, claimed_at)
  WHERE is_pre_populated = true AND claimed_at IS NULL;
