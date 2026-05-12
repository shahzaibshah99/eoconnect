-- ============================================================
-- 035_businesses_owner_id_nullable.sql
--
-- Allow owner_id to be NULL on businesses so pre-populated
-- (CSV-imported) listings can exist before being claimed.
--
-- Per scope F03: CSV import creates a listing with owner_id=NULL
-- and a claim_token. The member clicks the claim link, signs up,
-- and owner_id is set at that point via completeClaim().
--
-- The original NOT NULL constraint was blocking _createPrePopulatedListing
-- from inserting unclaimed rows at all.
-- ============================================================

ALTER TABLE public.businesses
  ALTER COLUMN owner_id DROP NOT NULL;
