import 'server-only'
import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { getEmbedding, businessEmbeddingText } from './embeddings'

export interface MarketTagAssignment {
  tag_id: string    // market_tags.id (UUID)
  confidence: number
}

const LLMOutputSchema = z.object({
  assignments: z.array(z.object({
    full_path:  z.string(),
    confidence: z.number().min(0).max(1),
  })).max(8),
})

/**
 * Assign structured taxonomy tags to a business.
 *
 * Pipeline:
 *   1. Sentinel check — skip if tagged within last 5 min (prevents double-run)
 *   2. Fetch business signals (name, tagline, description, website, tags, services)
 *   3. Embed the signals, vector-search 50 candidate taxonomy tags
 *   4. GPT selects from candidates — only leaf tags, no parent if child applies
 *   5. Persist to business_market_tags + stamp businesses.market_tags_assigned_at
 *
 * Returns assigned tag UUIDs + confidence, or null on any failure.
 * All errors are caught — callers treat null as "retry later."
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assignMarketTags(db: any, businessId: string): Promise<MarketTagAssignment[] | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[assign-market-tags] OPENAI_API_KEY not set — skipping')
    return null
  }

  try {
    // ── 1. Sentinel ──────────────────────────────────────────
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: recent } = await db
      .from('events_log')
      .select('id')
      .eq('type', 'market_tag_assignment')
      .eq('entity_id', businessId)
      .gte('created_at', fiveMinutesAgo)
      .limit(1)
    if (recent?.length) return null

    // ── 2. Gather signals ────────────────────────────────────
    const [{ data: biz }, { data: svcs }] = await Promise.all([
      db.from('businesses')
        .select('name, tagline, description, website, tags, city, country')
        .eq('id', businessId)
        .single(),
      db.from('services')
        .select('title')
        .eq('business_id', businessId)
        .eq('status', 'published'),
    ])

    if (!biz) return null

    const hasSignals = biz.name || biz.description || biz.tagline || biz.tags?.length
    if (!hasSignals) return null

    const serviceTitles = (svcs ?? []).map((s: { title: string }) => s.title)
    const embeddingText = businessEmbeddingText({ ...biz, serviceTitles })

    // ── 3. Embed + shortlist 50 candidate tags ───────────────
    let candidates: Array<{ id: string; full_path: string; match_weight: number }> = []

    const queryEmbedding = await getEmbedding(embeddingText)
    if (queryEmbedding) {
      const { data: tagCandidates } = await db.rpc('search_market_tags_by_embedding', {
        query_embedding: queryEmbedding,
        match_count: 50,
        min_similarity: 0.30,
      })
      candidates = tagCandidates ?? []
    }

    // Fallback: no embedding → grab top-50 specialism-level tags to give the LLM something
    if (candidates.length === 0) {
      const { data: fallback } = await db
        .from('market_tags')
        .select('id, full_path, match_weight')
        .eq('level', 5)
        .limit(50)
      candidates = fallback ?? []
    }

    if (candidates.length === 0) return null

    // ── 4. LLM tag selection ─────────────────────────────────
    const candidateList = candidates
      .map((t, i) => `${i + 1}. ${t.full_path}`)
      .join('\n')

    const businessContext = [
      biz.name        ? `Business name: ${biz.name}` : null,
      biz.tagline     ? `Tagline: ${biz.tagline}` : null,
      biz.description ? `Description: ${biz.description}` : null,
      biz.tags?.length ? `Current tags: ${biz.tags.join(', ')}` : null,
      serviceTitles.length ? `Services: ${serviceTitles.join(', ')}` : null,
    ].filter(Boolean).join('\n')

    const result = await generateText({
      model: openai('gpt-5-nano'),
      output: Output.object({ schema: LLMOutputSchema }),
      prompt: `You assign taxonomy tags to a business listing on a B2B marketplace for entrepreneurs.

Given the business details and a list of candidate taxonomy tags, select all tags that accurately describe what this business does.

Rules:
- Only select tags from the provided candidate list. Do not invent tags.
- Select the MOST SPECIFIC tag that applies within each branch. If a business qualifies for "FinTech SaaS" do NOT also select "SaaS" or "Software Development" as separate assignments — the hierarchy is implied.
- A business may legitimately operate across multiple distinct branches (e.g. both FinTech and HealthTech) — assign all that apply.
- Maximum 8 tags total.
- Confidence is 0–1: 1.0 = certain fit, 0.5 = reasonable but uncertain, 0.0 = doesn't fit.
- Only include tags with confidence >= 0.5.

Business details:
${businessContext}

Candidate taxonomy tags:
${candidateList}`,
    })

    const parsed = LLMOutputSchema.safeParse(result.output)
    if (!parsed.success || !parsed.data.assignments.length) return null

    // ── 5. Persist ───────────────────────────────────────────
    // Build full_path → id lookup from candidates
    const pathToId = new Map(candidates.map(t => [t.full_path, t.id]))

    const toInsert: Array<{
      business_id: string
      market_tag_id: string
      assigned_by: string
      confidence: number
    }> = []

    for (const a of parsed.data.assignments) {
      const tagId = pathToId.get(a.full_path)
      if (!tagId) continue
      toInsert.push({
        business_id:   businessId,
        market_tag_id: tagId,
        assigned_by:   'ai',
        confidence:    a.confidence,
      })
    }

    if (toInsert.length === 0) return null

    // Replace all previous AI-assigned tags for this business
    await db
      .from('business_market_tags')
      .delete()
      .eq('business_id', businessId)
      .eq('assigned_by', 'ai')

    const { error: insertErr } = await db
      .from('business_market_tags')
      .insert(toInsert)

    if (insertErr) {
      console.error('[assign-market-tags] insert failed:', insertErr.message)
      return null
    }

    // Stamp the business so the cron skips it next run
    await db
      .from('businesses')
      .update({ market_tags_assigned_at: new Date().toISOString() })
      .eq('id', businessId)

    // Write idempotency sentinel
    await db.from('events_log').insert({
      type:      'market_tag_assignment',
      entity_id: businessId,
      metadata:  { tag_count: toInsert.length },
    })

    return toInsert.map(r => ({ tag_id: r.market_tag_id, confidence: r.confidence }))
  } catch (err) {
    console.error('[assign-market-tags] failed for', businessId, err)
    return null
  }
}
