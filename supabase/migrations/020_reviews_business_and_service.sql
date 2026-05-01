-- ============================================================
-- 020_reviews_business_and_service.sql
-- Add structured "as which business" + "for which service" context
-- to reviews.
--
-- Why:
--   Reviews currently only carry the reviewer's profile id, so the
--   listing page renders the reviewer's NAME as the primary identity.
--   The user pointed out that on a B2B marketplace the more
--   meaningful identity is the reviewer's BUSINESS — which lets
--   readers see "Acme Studio thinks NexaBuild is great" rather
--   than a person they may not recognise. They also want the
--   review tied to a specific service of the reviewed business.
--
-- Both columns are nullable:
--   - reviewer_business_id is null for reviews from members who
--     don't have a business listed (still allowed; UI falls back
--     to person name).
--   - service_id is null for reviews left without picking a
--     service (treated as a review of the business as a whole).
--
-- ON DELETE SET NULL on both — deleting the reviewer's business
-- or the reviewed business's service shouldn't wipe the review
-- text. The review just loses the structured tag and falls back
-- to person/whole-business display.
-- ============================================================

alter table public.reviews
  add column if not exists reviewer_business_id uuid
    references public.businesses(id) on delete set null,
  add column if not exists service_id uuid
    references public.services(id) on delete set null;

-- Read-side indexes are partial on the non-null subset to keep
-- writes cheap. Most reviews will populate at least reviewer_business_id
-- (most members have at least one business by the time they're
-- reviewing), but service_id will skew sparser.
create index if not exists reviews_reviewer_business_idx
  on public.reviews (reviewer_business_id)
  where reviewer_business_id is not null;

create index if not exists reviews_service_idx
  on public.reviews (service_id)
  where service_id is not null;
