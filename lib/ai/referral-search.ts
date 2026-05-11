import { getEmbedding } from '@/lib/ai/embeddings'
import { currentTenant } from '@/lib/tenant'

export interface ReferralSearchResult {
  id: string
  referred_name: string
  referred_category: string
  referred_location: string
  full_text: string
  referrer_member_id: string
  source_post_id: string | null
  source_response_id: string | null
  relevance_score: number
  similarity: number
  created_at: string
}

/**
 * Find the top N most relevant past referrals for a given query text.
 *
 * Per scope F18: "When a new bulletin post is submitted, AI runs vector
 * similarity search across both referral tables. Top 3 most relevant past
 * responses surfaced in posted receipt AND in the post's reply thread."
 *
 * Uses the search_referrals_by_embedding RPC (migration 034) which does
 * the cosine similarity comparison via pgvector, then sorts by:
 *   1. relevance_score (satisfaction feedback bumped this)
 *   2. cosine similarity
 *   3. recency
 *
 * Returns [] if no API key, embedding fails, or no results above threshold.
 */
export async function searchReferrals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: {
    queryText: string
    boardType: 'business' | 'community'
    matchCount?: number
    minSimilarity?: number
  }
): Promise<ReferralSearchResult[]> {
  const { queryText, boardType, matchCount = 3, minSimilarity = 0.25 } = input

  // Embed the post's title + detail to search for semantically similar referrals
  const embedding = await getEmbedding(queryText)
  if (!embedding) return []

  try {
    const { data, error } = await db.rpc('search_referrals_by_embedding', {
      query_embedding: embedding,
      board: boardType,
      match_count: matchCount,
      min_similarity: minSimilarity,
      p_tenant_id: currentTenant(),
    }) as { data: ReferralSearchResult[] | null; error: { message: string } | null }

    if (error) {
      console.error('[referral-search] RPC error:', error.message)
      return []
    }

    return data ?? []
  } catch (err) {
    console.error('[referral-search] failed:', err)
    return []
  }
}
