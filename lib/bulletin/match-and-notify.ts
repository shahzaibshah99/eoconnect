import { createClient } from '@supabase/supabase-js'
import { getEmbedding } from '@/lib/ai/embeddings'
import { sendEmail } from '@/lib/email/send'
import { VERIFICATION_TIER } from '@/lib/bulletin-constants'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// Extract meaningful lowercase words from tags or free text.
// Splits on hyphens, underscores, spaces; drops stopwords and tokens < 3 chars.
export function extractKeywords(texts: string[]): Set<string> {
  const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'in', 'of', 'to', 'with', 'by', 'at', 'on', 'is', 'are', 'be', 'as', 'we', 'our', 'your'])
  const words = new Set<string>()
  for (const text of texts) {
    text.toLowerCase()
      .replace(/[-_/]/g, ' ')
      .split(/\s+/)
      .forEach(w => {
        const clean = w.replace(/[^a-z0-9]/g, '')
        if (clean.length >= 3 && !STOP.has(clean)) words.add(clean)
      })
  }
  return words
}

// Score how well a business's tags match the need keywords.
// Uses prefix matching so "consult" matches "consulting", "consultant" etc.
export function scoreTagMatch(bizTags: string[], needKeywords: Set<string>): number {
  if (!bizTags.length || !needKeywords.size) return 0
  const bizWords = extractKeywords(bizTags)
  let score = 0
  for (const needWord of needKeywords) {
    for (const bizWord of bizWords) {
      if (bizWord === needWord || bizWord.startsWith(needWord) || needWord.startsWith(bizWord)) {
        score++
        break
      }
    }
  }
  return score
}

// Weighted taxonomy score: sum match_weights of taxonomy tags shared between
// the post's candidate tags and this business's assigned taxonomy tags.
export function scoreTaxonomyMatch(
  bizTagIds: Set<string>,
  postTagWeights: Map<string, number>
): number {
  let total = 0
  for (const [tagId, weight] of postTagWeights) {
    if (bizTagIds.has(tagId)) total += weight
  }
  return total
}

export function bulletinMatchEmailHtml(input: {
  businessName: string
  ownerName: string
  postTitle: string
  posterName: string
  postUrl: string
}) {
  const { businessName, ownerName, postTitle, posterName, postUrl } = input
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9f6f0;">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
    <h1 style="font-size:18px;margin:0 0 12px;">Hi ${esc(ownerName)} — a member posted a need that matches ${esc(businessName)}</h1>
    <div style="background:#f4f1ec;border-left:4px solid #0A5C46;padding:12px 16px;margin:16px 0;border-radius:0 8px 8px 0;">
      <p style="margin:0;font-size:15px;font-weight:600;">${esc(postTitle)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#666;">Posted by ${esc(posterName)}</p>
    </div>
    <p style="font-size:14px;color:#444;line-height:1.5;">
      This member is looking for something your business may offer. View their full post and reply in the bulletin board.
    </p>
    <p style="margin-top:24px;">
      <a href="${postUrl}" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
        View the post &amp; reply
      </a>
    </p>
    <p style="font-size:12px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">
      You received this because your Member Market listing matches this member's business need.
    </p>
  </div>
</body></html>`
}

export async function matchAndNotify(input: {
  postId: string
  tags: string[]
  detail?: string
  country: string
  city: string | null
  postTitle: string
  posterName: string
  siteUrl: string
  // When true, run matching/scoring as normal but DON'T email matched members.
  // Used during WhatsApp testing so real members aren't notified. The post and
  // matched_business_ids are still produced.
  suppressEmails?: boolean
}): Promise<Array<{ id: string; name: string }>> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return []
  const svc = adminDb()

  type BizRow = {
    id: string; name: string; owner_id: string; tags: string[];
    verification_tag: string | null; created_at: string; country: string | null;
    profiles: { eo_membership_email: string | null; full_name: string | null } | null
  }

  // Fetch all published non-slow-replier businesses in the same country.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: candidates } = await (svc as any)
    .from('businesses')
    .select('id, name, owner_id, tags, verification_tag, created_at, country, profiles!owner_id(eo_membership_email, full_name)')
    .eq('status', 'published')
    .eq('slow_replier', false)
    .not('owner_id', 'is', null)
    .ilike('country', input.country)
    .limit(200) as { data: BizRow[] | null }

  if (!candidates || candidates.length === 0) return []

  // ── Taxonomy scoring (primary signal) ───────────────────────
  const postTagWeights = new Map<string, number>()

  const postText = [input.postTitle, ...input.tags, input.detail ?? '']
    .filter(Boolean).join(' ')
  const postEmbedding = await getEmbedding(postText)

  if (postEmbedding) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tagMatches } = await (svc as any).rpc('search_market_tags_by_embedding', {
      query_embedding: postEmbedding,
      match_count: 15,
      min_similarity: 0.35,
    }) as { data: Array<{ id: string; full_path: string; match_weight: number }> | null }

    for (const t of tagMatches ?? []) {
      postTagWeights.set(t.id, t.match_weight)
    }
  }

  const bizTagMap = new Map<string, Set<string>>()

  if (postTagWeights.size > 0) {
    const candidateIds = candidates.map(b => b.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bizTags } = await (svc as any)
      .from('business_market_tags')
      .select('business_id, market_tag_id')
      .in('business_id', candidateIds) as {
        data: Array<{ business_id: string; market_tag_id: string }> | null
      }

    for (const row of bizTags ?? []) {
      if (!bizTagMap.has(row.business_id)) bizTagMap.set(row.business_id, new Set())
      bizTagMap.get(row.business_id)!.add(row.market_tag_id)
    }
  }

  // ── Freeform keyword scoring (fallback / tiebreaker) ─────────
  const needKeywords = extractKeywords([...input.tags, input.detail ?? ''])

  // ── Combined scoring: taxonomy weighted 2× over freeform keywords ──
  const scored = candidates
    .map(biz => {
      const taxonomyScore = scoreTaxonomyMatch(bizTagMap.get(biz.id) ?? new Set(), postTagWeights)
      const keywordScore  = scoreTagMatch(biz.tags ?? [], needKeywords)
      return { biz, score: taxonomyScore * 2 + keywordScore }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const aTier = VERIFICATION_TIER[a.biz.verification_tag ?? 'unverified'] ?? 99
      const bTier = VERIFICATION_TIER[b.biz.verification_tag ?? 'unverified'] ?? 99
      if (aTier !== bTier) return aTier - bTier
      return new Date(b.biz.created_at).getTime() - new Date(a.biz.created_at).getTime()
    })

  const sorted = scored.slice(0, 6).map(({ biz }) => biz)

  if (sorted.length === 0) return []

  const postUrl = `${input.siteUrl}/bulletin/${input.postId}`

  // Skip member emails when suppressed (e.g. WhatsApp testing phase). Matching
  // still ran, so the caller gets matched_business_ids for verification.
  if (input.suppressEmails) {
    console.log('[bulletin-match] emails suppressed for post', input.postId, `(${sorted.length} would-be recipients)`)
    return sorted.map(b => ({ id: b.id, name: b.name }))
  }

  for (const biz of sorted) {
    const email = biz.profiles?.eo_membership_email
    if (!email) continue
    sendEmail({
      to: email,
      subject: `New business need matches your listing: "${input.postTitle}"`,
      html: bulletinMatchEmailHtml({
        businessName: biz.name,
        ownerName: biz.profiles?.full_name ?? 'there',
        postTitle: input.postTitle,
        posterName: input.posterName,
        postUrl,
      }),
    }).catch(err => console.error('[bulletin-match] email failed for', biz.id, err))
  }

  return sorted.map(b => ({ id: b.id, name: b.name }))
}
