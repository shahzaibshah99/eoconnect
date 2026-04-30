-- ============================================================
-- 018_global_unique_business_website.sql
-- Promote the duplicate-website rule from per-owner to GLOBAL.
--
-- Background:
--   - Migration 016 made (owner_id, website) unique — same member
--     couldn't list the same URL twice, but two different members
--     could each list "acme.com".
--   - Andrew (Founder) initially flagged cross-member dupes as a
--     moderation question (co-founders, franchisees, etc.).
--   - Team revisited: an admin-review queue was deemed a launch
--     blocker, so we're going with the simpler hard-block instead.
--
-- This migration:
--   1. Drops the per-owner unique index from 016.
--   2. Resolves any pre-existing cross-member collisions by
--      nullifying `website` on all but the OLDEST listing per
--      normalized URL. (Same approach as 017 used for within-owner
--      dupes — keep the canonical row, clear the URL on the others
--      so the member can fix it before re-saving.)
--   3. Creates a GLOBAL partial unique index on website_normalized.
--
-- Result: first member to list a URL "wins". Subsequent members
-- are blocked at create-time with a friendly error pointing them
-- at the EO team if they believe the existing claim is wrong.
-- Manual moderation lives in /admin/listings — admins can delete
-- or transfer the existing listing if the wrong member claimed it.
-- ============================================================

-- 1. Drop the per-owner index from 016. CREATE UNIQUE INDEX in 016
--    used `if not exists`, so the drop here is also tolerant of the
--    case where 016 hadn't been applied yet (e.g. failed at index
--    creation time).
drop index if exists public.businesses_unique_website_per_owner;

-- 2. Resolve cross-member collisions. ROW_NUMBER ranks rows by
--    created_at within each normalized-URL group; everything past
--    the oldest gets its website cleared. owner_id is intentionally
--    NOT in the partition key here — that's the whole point of the
--    promotion. Within-owner dupes (if migration 017 was skipped
--    for any reason) get caught here as a side-effect since they
--    also share website_normalized.
with ranked as (
  select
    id,
    row_number() over (
      partition by website_normalized
      order by created_at asc, id asc
    ) as rk
  from public.businesses
  where website_normalized is not null
)
update public.businesses b
   set website = null
  from ranked r
 where b.id = r.id
   and r.rk > 1;

-- 3. Global partial unique index. Partial because members aren't
--    required to have a website, and NULL ≠ NULL would otherwise
--    block multiple websiteless listings.
create unique index if not exists businesses_unique_website
  on public.businesses (website_normalized)
  where website_normalized is not null;
