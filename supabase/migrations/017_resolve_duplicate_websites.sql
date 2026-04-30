-- ============================================================
-- 017_resolve_duplicate_websites.sql
-- Fixup migration for 016.
--
-- Problem: applying 016 against an existing prod / staging dataset
-- can fail at CREATE UNIQUE INDEX time if a single owner already
-- has two listings pointing at the same website (the original
-- bug 016 was meant to prevent — pre-existing rows from before the
-- guard existed). Real failure observed:
--
--   ERROR:  23505: could not create unique index
--           "businesses_unique_website_per_owner"
--   DETAIL: Key (owner_id, website_normalized)=
--           (ddd5441a-…, syedmaazsaeed.dev) is duplicated.
--
-- Resolution strategy: per (owner_id, website_normalized) collision
-- group, keep the OLDEST listing intact and clear `website` on the
-- newer ones. We don't delete rows — the member may have content
-- on the listing they want to keep — they just need to fix the URL
-- before the duplicate can be saved with a real value again.
--
-- Ordering by created_at ascending preserves the original listing
-- (most likely the canonical one); duplicates created later are
-- the ones that get nullified.
--
-- This migration is also safe to re-run: nullifying an already-
-- nullified field is a no-op, and it idempotently re-attempts
-- creation of the unique index from 016 in case that step rolled
-- back when the original migration failed.
-- ============================================================

-- 1. Make sure the generated column from 016 exists (idempotent).
--    Re-declared here so this migration can self-heal if 016 rolled
--    back its CREATE INDEX and the column was lost in the same txn.
alter table public.businesses
  add column if not exists website_normalized text
    generated always as (
      case
        when website is null or btrim(website) = '' then null
        else regexp_replace(
               regexp_replace(
                 regexp_replace(
                   lower(btrim(website)),
                   '^https?://', ''
                 ),
                 '^www\.', ''
               ),
               '/+$', ''
             )
      end
    ) stored;

-- 2. Find every collision group and clear the website on every row
--    except the oldest.
--
--    ROW_NUMBER() OVER PARTITION lets us label the oldest row as 1,
--    everyone else as 2..N. We then null the website on rows where
--    the rank is > 1.
with ranked as (
  select
    id,
    row_number() over (
      partition by owner_id, website_normalized
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

-- 3. Now that collisions are resolved, create the unique index
--    that 016 was supposed to create. `if not exists` makes this
--    a no-op if 016 partially succeeded.
create unique index if not exists businesses_unique_website_per_owner
  on public.businesses (owner_id, website_normalized)
  where website_normalized is not null;
