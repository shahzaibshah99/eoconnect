-- ============================================================
-- 022_referral_response_tables.sql
-- Referral response tables for business and community boards.
-- pgvector already enabled in 006 — just creating tables.
-- ivfflat now, scope says switch to HNSW at 10K+ embeddings.
-- tenant_id keeps EO and YPO referrals separate automatically.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.referral_responses_business (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  source_post_id uuid,
  source_response_id uuid,
  referrer_member_id uuid NOT NULL REFERENCES public.profiles(id),
  referred_name text,
  referred_category text,
  referred_location text,
  linked_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  full_text text,
  embedding vector(1536),
  relevance_score float DEFAULT 0,
  tenant_id text NOT NULL DEFAULT 'eo',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referral_responses_community (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  source_post_id uuid,
  source_response_id uuid,
  referrer_member_id uuid NOT NULL REFERENCES public.profiles(id),
  referred_name text,
  referred_category text,
  referred_location text,
  linked_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  full_text text,
  embedding vector(1536),
  relevance_score float DEFAULT 0,
  tenant_id text NOT NULL DEFAULT 'eo',
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.referral_responses_business ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_responses_community ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read business referrals"
  ON public.referral_responses_business FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Members can read community referrals"
  ON public.referral_responses_community FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ivfflat indexes — switch to HNSW when embeddings exceed 10K
CREATE INDEX IF NOT EXISTS referral_business_embedding_idx
  ON public.referral_responses_business
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS referral_community_embedding_idx
  ON public.referral_responses_community
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Tenant + recency indexes
CREATE INDEX IF NOT EXISTS referral_business_tenant_idx
  ON public.referral_responses_business (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS referral_community_tenant_idx
  ON public.referral_responses_community (tenant_id, created_at DESC);