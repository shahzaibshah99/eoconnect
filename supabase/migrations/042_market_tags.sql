-- ============================================================
-- 042_market_tags.sql
-- Structured 5-level taxonomy tagging system for businesses.
--
-- market_tags         — the reference taxonomy (loaded from CSV)
-- business_market_tags — which tags are assigned to which business
--
-- Only leaf-level (most specific) tags are stored per business.
-- Parent-path hierarchy matching is done at query time via full_path LIKE.
-- ============================================================

-- ── market_tags ───────────────────────────────────────────────
create table if not exists public.market_tags (
  id                    uuid          default uuid_generate_v4() primary key,
  tag_id                text          not null unique,        -- stable CSV key e.g. "1"
  sector                text          not null,               -- level 1
  industry              text          not null,               -- level 2
  niche                 text          not null,               -- level 3
  sub_niche             text,                                  -- level 4 (nullable — not all paths reach level 5)
  specialism            text,                                  -- level 5 (nullable)
  tag_type              text,                                  -- e.g. "hierarchy"
  level                 smallint      not null check (level between 1 and 5),
  full_path             text          not null,               -- "Sector > Industry > Niche > Sub-niche > Specialism"
  match_weight          numeric(3,2)  not null default 1.0,   -- 0.20 / 0.40 / 0.60 / 0.80 / 1.00 by level
  notes                 text,
  embedding             vector(1536),                          -- text-embedding-3-small of full_path
  embedding_updated_at  timestamptz,
  created_at            timestamptz   default now()
);

alter table public.market_tags enable row level security;

-- Authenticated users can read the reference taxonomy
create policy "Authenticated users can read market_tags"
  on public.market_tags for select
  using (auth.uid() is not null);

-- HNSW index for fast nearest-neighbor tag candidate lookup
create index if not exists market_tags_embedding_idx
  on public.market_tags
  using hnsw (embedding vector_cosine_ops);

create index if not exists market_tags_level_idx
  on public.market_tags (level);

create index if not exists market_tags_sector_idx
  on public.market_tags (sector);

-- trigram index to speed up full_path LIKE queries used in hierarchy rollup
create extension if not exists pg_trgm;
create index if not exists market_tags_full_path_trgm_idx
  on public.market_tags
  using gin (full_path gin_trgm_ops);


-- ── business_market_tags ──────────────────────────────────────
create table if not exists public.business_market_tags (
  id              uuid          default uuid_generate_v4() primary key,
  business_id     uuid          not null references public.businesses(id) on delete cascade,
  market_tag_id   uuid          not null references public.market_tags(id) on delete cascade,
  assigned_at     timestamptz   default now(),
  assigned_by     text          not null default 'ai'
                                check (assigned_by in ('ai', 'admin', 'user')),
  confidence      numeric(4,3),
  unique (business_id, market_tag_id)
);

alter table public.business_market_tags enable row level security;

-- Members can read market tags for any published business
create policy "Authenticated users can read business_market_tags"
  on public.business_market_tags for select
  using (auth.uid() is not null);

-- Only service_role writes (AI pipeline, admin endpoints)
create index if not exists bmt_business_idx
  on public.business_market_tags (business_id);

create index if not exists bmt_tag_idx
  on public.business_market_tags (market_tag_id);


-- ── businesses: tagging metadata columns ─────────────────────
alter table public.businesses
  add column if not exists market_tags_assigned_at  timestamptz,
  add column if not exists market_tags_version      smallint default 0;
