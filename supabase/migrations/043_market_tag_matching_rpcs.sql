-- ============================================================
-- 043_market_tag_matching_rpcs.sql
-- RPC functions for the taxonomy tagging system.
--
-- search_market_tags_by_embedding  — find candidate tags for a query/business
-- match_businesses_by_market_tags  — score businesses by taxonomy tag overlap
-- businesses_missing_market_tags   — cron selection query
-- ============================================================

-- ── search_market_tags_by_embedding ─────────────────────────
-- Given a query embedding, returns the closest taxonomy tags.
-- Used to:
--   (a) shortlist 50 candidate tags for the AI tagging pipeline
--   (b) map a search query / bulletin post to taxonomy tags at query time
--
-- Mirrors search_businesses_by_embedding exactly.
create or replace function public.search_market_tags_by_embedding(
  query_embedding  vector(1536),
  match_count      int   default 50,
  min_similarity   float default 0.35
)
returns table (
  id           uuid,
  full_path    text,
  match_weight numeric,
  similarity   float
)
language sql stable
security definer
set search_path = public
as $$
  select
    mt.id,
    mt.full_path,
    mt.match_weight,
    1 - (mt.embedding <=> query_embedding) as similarity
  from public.market_tags mt
  where mt.embedding is not null
    and (1 - (mt.embedding <=> query_embedding)) >= min_similarity
  order by mt.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.search_market_tags_by_embedding to authenticated, service_role;


-- ── match_businesses_by_market_tags ─────────────────────────
-- Given a set of taxonomy tag IDs (derived from a bulletin post or
-- search query), returns published businesses with a weighted score.
--
-- Hierarchy rollup (bidirectional):
--   A requested level-2 tag matches stored level-5 tags in the same branch
--   (broad request → specific business) AND a stored level-2 tag matches a
--   requested level-5 tag (broad business → specific request).
--   Match weight is the stored tag's weight (closer to specialism = higher signal).
create or replace function public.match_businesses_by_market_tags(
  p_tag_ids    uuid[],
  match_count  int default 50
)
returns table (
  business_id  uuid,
  score        numeric
)
language sql stable
security definer
set search_path = public
as $$
  with requested as (
    select id, full_path, match_weight
    from   public.market_tags
    where  id = any(p_tag_ids)
  ),
  hits as (
    -- One hit per (business, requested-tag) pair — take the best weight match.
    -- Bidirectional: stored tag is descendant-or-ancestor of requested tag.
    select
      bmt.business_id,
      req.id                    as requested_tag_id,
      max(mt.match_weight)      as best_weight
    from   public.business_market_tags  bmt
    join   public.market_tags           mt  on mt.id = bmt.market_tag_id
    join   requested                    req
           on  mt.full_path like req.full_path || '%'   -- stored is more specific
            or req.full_path like mt.full_path || '%'   -- stored is more general
    group  by bmt.business_id, req.id
  )
  select
    h.business_id,
    cast(sum(h.best_weight) as numeric(6,3)) as score
  from     hits h
  join     public.businesses b on b.id = h.business_id
  where    b.status = 'published'
  group by h.business_id
  order by score desc
  limit    match_count;
$$;

grant execute on function public.match_businesses_by_market_tags to authenticated, service_role;


-- ── businesses_missing_market_tags ───────────────────────────
-- Returns published businesses that have not yet been taxonomy-tagged.
-- Used by the daily backfill cron and the one-shot admin endpoint.
-- Mirrors businesses_missing_embeddings exactly.
create or replace function public.businesses_missing_market_tags(batch_size int default 50)
returns table (
  id          uuid,
  name        text,
  tagline     text,
  description text,
  website     text,
  tags        text[]
)
language sql stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.tagline, b.description, b.website, b.tags
  from   public.businesses b
  where  b.status = 'published'
    and  b.market_tags_assigned_at is null
  order  by b.created_at desc
  limit  batch_size;
$$;

grant execute on function public.businesses_missing_market_tags to authenticated, service_role;
