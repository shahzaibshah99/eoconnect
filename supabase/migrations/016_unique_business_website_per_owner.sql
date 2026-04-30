-- ============================================================
-- 016_unique_business_website_per_owner.sql
-- Block a single member from creating multiple businesses with
-- the same website URL.
--
-- Andrew (Founder) settled the qualifying criteria:
--   "Business names could be fairly generic. We'd kind of have to
--    run with the URL — that would be the defining characteristic."
-- Shahzaib added: "URL and EO member profile."
--
-- So uniqueness is scoped to (owner_id, normalized_website). Two
-- different members CAN list the same website (e.g. two co-founders
-- of the same company each adding it to their own profile) — that's
-- a moderation question, not a hard rule. One member listing the
-- same URL twice is the bug we're stopping.
--
-- Normalization: lower-case, strip protocol, strip leading www.,
-- strip trailing slashes. So all of these collapse to "remap.ai":
--   "https://Remap.AI/"      → remap.ai
--   "http://www.remap.ai"    → remap.ai
--   " remap.ai "             → remap.ai
--   "remap.ai/about"         → remap.ai/about (paths preserved —
--                              two different products on the same
--                              domain are legitimately distinct)
--
-- Stored generated column means the index gets to use the value
-- directly without recomputing per-row, and the application just
-- INSERTs the original `website` — Postgres derives website_normalized
-- automatically.
-- ============================================================

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

-- Partial: ignore rows with no website (members aren't required to
-- have one, and NULL ≠ NULL would otherwise prevent any two
-- websiteless businesses under the same owner — clearly wrong).
create unique index if not exists businesses_unique_website_per_owner
  on public.businesses (owner_id, website_normalized)
  where website_normalized is not null;
