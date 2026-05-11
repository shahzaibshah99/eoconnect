-- ============================================================
-- 034_referral_search_rpc.sql
-- Vector similarity search across both referral tables for F18.
--
-- The tables (referral_responses_business/community) already exist
-- from migration 022. This adds the RPC that the AI concierge calls
-- to surface the top-3 most relevant past referrals for a given
-- bulletin post query.
--
-- Ranking: cosine similarity DESC (primary) then relevance_score
-- (updated by satisfaction feedback loop) then recency.
--
-- Note: ivfflat index requires ≥ lists (100) rows to be used.
-- Before the DB has 100 embeddings it falls back to a seq scan —
-- correct but slower. On a small dataset this is immaterial.
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_referrals_by_embedding(
  query_embedding vector(1536),
  board          text,           -- 'business' or 'community'
  match_count    int     DEFAULT 3,
  min_similarity float   DEFAULT 0.25,
  p_tenant_id    text    DEFAULT 'eo'
)
RETURNS TABLE (
  id                  uuid,
  referred_name       text,
  referred_category   text,
  referred_location   text,
  full_text           text,
  referrer_member_id  uuid,
  source_post_id      uuid,
  source_response_id  uuid,
  relevance_score     float,
  similarity          float,
  created_at          timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Probe more lists so the ivfflat index trades a bit of speed for
  -- better recall. probes=10 on lists=100 = 10% of index scanned.
  SET LOCAL ivfflat.probes = 10;

  IF board = 'community' THEN
    RETURN QUERY
    SELECT
      r.id, r.referred_name, r.referred_category, r.referred_location,
      r.full_text, r.referrer_member_id, r.source_post_id, r.source_response_id,
      r.relevance_score,
      1 - (r.embedding <=> query_embedding) AS similarity,
      r.created_at
    FROM public.referral_responses_community r
    WHERE r.tenant_id = p_tenant_id
      AND r.embedding IS NOT NULL
      AND 1 - (r.embedding <=> query_embedding) >= min_similarity
    ORDER BY
      r.relevance_score DESC,
      r.embedding <=> query_embedding,
      r.created_at DESC
    LIMIT match_count;
  ELSE
    -- Default to business board
    RETURN QUERY
    SELECT
      r.id, r.referred_name, r.referred_category, r.referred_location,
      r.full_text, r.referrer_member_id, r.source_post_id, r.source_response_id,
      r.relevance_score,
      1 - (r.embedding <=> query_embedding) AS similarity,
      r.created_at
    FROM public.referral_responses_business r
    WHERE r.tenant_id = p_tenant_id
      AND r.embedding IS NOT NULL
      AND 1 - (r.embedding <=> query_embedding) >= min_similarity
    ORDER BY
      r.relevance_score DESC,
      r.embedding <=> query_embedding,
      r.created_at DESC
    LIMIT match_count;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_referrals_by_embedding TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_referrals_by_embedding TO service_role;
