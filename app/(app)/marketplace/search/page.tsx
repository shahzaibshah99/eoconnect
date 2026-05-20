import { Suspense } from 'react'
import { after } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { SearchBar } from '@/components/marketplace/search-bar'
import { FilterPanel } from '@/components/marketplace/filter-panel'
import { MobileFilterBar } from '@/components/marketplace/mobile-filter-bar'
import { ListingCard } from '@/components/marketplace/listing-card'
import { getEmbedding } from '@/lib/ai/embeddings'
import { refreshBusinessEmbedding } from '@/lib/ai/refresh-business-embedding'
import { parseSearchQuery } from '@/lib/ai/parse-search'
import { pickAds } from '@/lib/ads/picker'
import { SponsoredCard } from '@/components/marketplace/sponsored-card'
import type { Business } from '@/types/database'

type SearchParams = {
  q?: string
  category?: string | string[]
  country?: string
  city?: string
  sort?: string
  smart?: string
  // F09: new ranking-aware filter params
  tag?: string          // verification_tag — 'eo_member' | 'eo_alumni' | etc.
  team_size?: string    // businesses.team_size — '1-10' | '11-50' | etc.
  item_type?: string    // 'service' | 'product' — filter to businesses that have at least one
  revenue_range?: string // businesses.revenue_range — e.g. 'under-1m' | '1m-10m' | etc.
}

// ── Member Market ranking ─────────────────────────────────────
//
// Per scope F09: results are re-ordered by (slow_replier, verification
// tier, endorsement count, original relevance position).
//
// "Keyword relevance is #1" — preserved as the final tiebreaker.
// Within the same tier/endorsement band, higher-similarity results
// sit above lower-similarity ones (original array index is preserved).
//
// Slow replier listings rank LAST within each tier (not hidden).
// VERIFICATION_TIER lives in lib/bulletin-constants.ts (shared with
// the F04 bulletin matching engine).
import { VERIFICATION_TIER } from '@/lib/bulletin-constants'

function applyMemberMarketRanking(
  results: Business[],
  endorseMap: Map<string, number>
): Business[] {
  return [...results]
    .map((b, idx) => ({ b, idx }))
    .sort((x, y) => {
      // 1. Slow replier penalty — always last within their tier
      const xSlow = x.b.slow_replier ? 1 : 0
      const ySlow = y.b.slow_replier ? 1 : 0
      if (xSlow !== ySlow) return xSlow - ySlow

      // 2. Verification tier (lower = better)
      const xTier = VERIFICATION_TIER[x.b.verification_tag ?? 'unverified'] ?? 99
      const yTier = VERIFICATION_TIER[y.b.verification_tag ?? 'unverified'] ?? 99
      if (xTier !== yTier) return xTier - yTier

      // 3. Endorsement count (higher = better)
      const xEnd = endorseMap.get(x.b.id) ?? 0
      const yEnd = endorseMap.get(y.b.id) ?? 0
      if (xEnd !== yEnd) return yEnd - xEnd

      // 4. Original position (preserves vector similarity ordering)
      return x.idx - y.idx
    })
    .map(({ b }) => b)
}

interface SearchPageProps {
  searchParams: Promise<SearchParams>
}


async function SearchResults({ searchParams }: SearchPageProps) {
  const params = await searchParams
  // Runtime diagnostic: is OPENAI_API_KEY actually in process.env on
  // the deployed container? Build logs don't show env vars, and the
  // [search] line below only reports embedding_ok=0/1 which can be 0
  // for two completely different reasons (key missing OR OpenAI call
  // failed). This isolates the first cause.
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[search] OPENAI_API_KEY is NOT set at runtime — vector search and AI parser will be skipped')
  }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: categories } = await db
    .from('categories').select('*').eq('active', true).order('sort_order')

  // The 11 canonical EO regions, matching profiles.region's check
  // constraint (migration 008). The filter UI surfaces this list;
  // any other value in the URL is ignored.
  const ALLOWED_REGIONS = [
    'Asia Pacific',
    'Canada',
    'Europe',
    'Japan',
    'Latin America/Caribbean',
    'MEPA',
    'North Asia',
    'South Asia',
    'United States - Central',
    'United States - East',
    'United States - West',
  ]
  const cityHard = params.city
  // The URL param is named `country` for backwards-compat with old
  // links and the existing FilterPanel — but its value is actually
  // the EO region of the listing's owner. Businesses don't carry a
  // region column (region is a member-level attribute); we resolve
  // it through the owner's profile.row below before applying it as
  // a filter on owner_id.
  const regionHard = (params.country && ALLOWED_REGIONS.includes(params.country)) ? params.country : null
  const urlSlugs = Array.isArray(params.category)
    ? params.category
    : params.category ? [params.category] : []
  const hardCatIds: string[] = (urlSlugs.length > 0 && categories)
    ? categories.filter((c: { slug: string; id: string }) => urlSlugs.includes(c.slug)).map((c: { id: string }) => c.id)
    : []

  // F09 new filters
  const tagFilter = params.tag?.trim() || null       // verification_tag exact match
  const teamSizeFilter = params.team_size?.trim() || null   // team_size exact match
  const itemTypeFilter = (params.item_type === 'service' || params.item_type === 'product')
    ? params.item_type : null
  const revenueRangeFilter = params.revenue_range?.trim() || null

  // If item_type filter is active, pre-fetch business IDs that have at
  // least one service/product of that type. Null = no filter.
  let itemTypeBusinessIds: string[] | null = null
  if (itemTypeFilter) {
    const { data: svcRows } = await db
      .from('services')
      .select('business_id')
      .eq('status', 'published')
      .eq('item_type', itemTypeFilter) as { data: Array<{ business_id: string }> | null }
    itemTypeBusinessIds = [...new Set((svcRows ?? []).map(r => r.business_id))]
    // Zero matches → no results can satisfy this filter. Short-circuit
    // by pushing an impossible ID instead of letting the IN([]) fail.
    if (itemTypeBusinessIds.length === 0) itemTypeBusinessIds = ['00000000-0000-0000-0000-000000000000']
  }

  // Resolve region → list of country names via the eo_chapters
  // reference table. The user wants the BUSINESS's location to
  // determine region membership, not the owner's profile region —
  // a member based in EO Brisbane could list a business operating
  // out of London, and that listing should show up under "Europe"
  // even though the owner's chapter is "Asia Pacific".
  //
  // eo_chapters maps (region, country) for every EO chapter. We
  // pull every unique country in the selected region, then filter
  // businesses where their country text matches any of those names
  // (ILIKE — country fields can be free text and casing varies
  // depending on how the LocationPicker normalised them).
  let countriesInRegion: string[] | null = null
  if (regionHard) {
    const { data: chapterCountries } = await db
      .from('eo_chapters')
      .select('country')
      .eq('region', regionHard)
      .not('country', 'is', null) as { data: Array<{ country: string | null }> | null }
    const unique = new Set<string>()
    for (const c of chapterCountries ?? []) {
      if (c.country) unique.add(c.country)
    }
    countriesInRegion = Array.from(unique)
  }

  const buildBase = () => {
    let q = db.from('businesses').select('*').eq('status', 'published')
    if (cityHard) q = q.ilike('city', `%${cityHard}%`)
    if (countriesInRegion !== null) {
      if (countriesInRegion.length === 0) {
        q = q.eq('id', '00000000-0000-0000-0000-000000000000')
      } else {
        const orFilter = countriesInRegion
          .map(c => `country.ilike.${c.replace(/,/g, '\\,')}`)
          .join(',')
        q = q.or(orFilter)
      }
    }
    if (hardCatIds.length > 0) q = q.overlaps('category_ids', hardCatIds)
    // F09 new filters
    if (tagFilter) q = q.eq('verification_tag', tagFilter)
    if (teamSizeFilter) q = q.eq('team_size', teamSizeFilter)
    if (revenueRangeFilter) q = q.eq('revenue_range', revenueRangeFilter)
    if (itemTypeBusinessIds) q = q.in('id', itemTypeBusinessIds)
    return q
  }

  let results: Business[] = []
  let totalCount: number | null = null
  const queryText = params.q?.trim()
  const tierCounts: Record<string, number> = {}

  // ── Tag keyword helpers ────────────────────────────────────────
  // Tags are explicit business signals — "AI Consultant" tag should
  // always match a search for "AI consultant" regardless of vector
  // similarity. We extract words from the query and do prefix matching
  // against business tags, running it in parallel with vector search.

  function extractSearchKeywords(query: string): string[] {
    const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'in', 'of', 'to', 'with'])
    return query.toLowerCase()
      .replace(/[-_]/g, ' ')
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length >= 3 && !STOP.has(w))
  }

  function tagsMatchQuery(tags: string[], keywords: string[]): boolean {
    if (!tags.length || !keywords.length) return false
    const bizWords = tags.flatMap(t =>
      t.toLowerCase().replace(/[-_]/g, ' ').split(/\s+/).filter(w => w.length >= 3)
    )
    const wordMatches = (kw: string) =>
      bizWords.some(bw => bw === kw || bw.startsWith(kw) || kw.startsWith(bw))
    // For multi-word queries (e.g. "AI consultant"), require ALL keywords to
    // match so "Business Consulting" doesn't match "AI consultant" just because
    // "consult" overlaps. Single-word queries only need 1 match.
    const required = Math.min(keywords.length, 2)
    const matched = keywords.filter(wordMatches).length
    return matched >= required
  }

  if (queryText) {
    // Run parser, embedding, AND tag candidates in parallel.
    // Tag candidates = all published businesses (respecting active filters)
    // so we can score them by keyword overlap client-side.
    const [parsed, queryEmbedding, tagCandidatesRes] = await Promise.all([
      categories ? parseSearchQuery(queryText, categories) : Promise.resolve(null),
      getEmbedding(queryText),
      buildBase().select('id, tags').limit(200),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tagCandidates = (tagCandidatesRes as any).data as Array<{ id: string; tags: string[] }> | null
    const searchKeywords = extractSearchKeywords(queryText)
    const tagMatchIds = new Set(
      (tagCandidates ?? [])
        .filter(b => tagsMatchQuery(b.tags ?? [], searchKeywords))
        .map(b => b.id)
    )
    tierCounts.tag_matches = tagMatchIds.size
    const parsedCatIds: string[] = (parsed?.categorySlugs.length && categories)
      ? categories.filter((c: { slug: string; id: string }) => parsed.categorySlugs.includes(c.slug)).map((c: { id: string }) => c.id)
      : []
    tierCounts.parsed_categories = parsedCatIds.length
    tierCounts.parsed_city = parsed?.city ? 1 : 0
    tierCounts.parsed_country = parsed?.country ? 1 : 0
    tierCounts.embedding_ok = queryEmbedding ? 1 : 0
    if (queryEmbedding) {
      const { data: matches, error: rpcErr } = await db.rpc('search_businesses_by_embedding', {
        query_embedding: queryEmbedding,
        match_count: 50,
        // 0.50 — raised from 0.30. Tag search now handles exact keyword
        // matches so vector search only needs to catch semantic matches.
        // At 0.50, only genuinely similar businesses surface (e.g. "AI
        // Consultancy" won't match "Business Consulting" at 32% similarity).
        min_similarity: 0.60,
      }) as { data: Array<{ id: string; similarity: number }> | null; error: { message: string } | null }
      if (rpcErr) tierCounts.vector_rpc_error = 1
      tierCounts.tier1_vector_raw = matches?.length ?? 0
      // Surface the top-similarity score for visibility — when
      // tier1_vector_raw is 0, this tells us whether anything
      // CAME CLOSE (e.g. 0.28 = barely missed) vs there being no
      // semantically-related listings at all (e.g. 0.10 across
      // the board → genuinely nothing relevant in the index).
      if (matches && matches.length > 0) {
        tierCounts.tier1_top_similarity = Math.round(matches[0].similarity * 100) / 100
      } else {
        // No matches passed the 0.30 threshold. Run the RPC again
        // with min_similarity=0 so we can see the BEST near-miss in
        // the logs. This is purely diagnostic — we don't surface
        // these results to the user; they're just for "is the
        // embedding-vs-corpus distance large or small?" debugging.
        const { data: nearMiss } = await db.rpc('search_businesses_by_embedding', {
          query_embedding: queryEmbedding,
          match_count: 1,
          min_similarity: 0,
        }) as { data: Array<{ id: string; similarity: number }> | null }
        if (nearMiss && nearMiss.length > 0) {
          tierCounts.tier1_near_miss = Math.round(nearMiss[0].similarity * 100) / 100
        }
      }

      if (matches && matches.length > 0) {
        const orderedIds = matches.map(m => m.id)
        // Build the hydration query, layering AI-parsed filters on top of
        // the user's URL-explicit ones (buildBase already handles URL ones).
        let bizQuery = buildBase().in('id', orderedIds)
        if (parsedCatIds.length > 0) {
          bizQuery = bizQuery.overlaps('category_ids', parsedCatIds)
        }
        if (parsed?.city) bizQuery = bizQuery.ilike('city', `%${parsed.city}%`)
        if (parsed?.country) bizQuery = bizQuery.ilike('country', `%${parsed.country}%`)

        const { data: rows } = await bizQuery as { data: Business[] | null }
        const byId = new Map((rows ?? []).map(r => [r.id, r]))
        results = orderedIds.map(id => byId.get(id)).filter((b): b is Business => !!b)
        tierCounts.tier1_vector_filtered = results.length
      }
    }

    // ── Tier 2: Postgres full-text search ──
    if (results.length === 0) {
      const { data: rows } = await buildBase()
        .textSearch('search_vector', queryText, { type: 'websearch', config: 'english' })
        .limit(50) as { data: Business[] | null }
      tierCounts.tier2_fts = rows?.length ?? 0
      results = rows ?? []
    }

    // ── Tier 3: Plain ILIKE on business name/tagline/description ──
    if (results.length === 0) {
      const escaped = queryText.replace(/[%_\\]/g, m => '\\' + m)
      const { data: rows } = await buildBase()
        .or(`name.ilike.%${escaped}%,tagline.ilike.%${escaped}%,description.ilike.%${escaped}%`)
        .limit(50) as { data: Business[] | null }
      tierCounts.tier3_ilike_business = rows?.length ?? 0
      results = rows ?? []
    }

    // ── Tier 4: Services title/description match → parent business ──
    if (results.length === 0) {
      const escaped = queryText.replace(/[%_\\]/g, m => '\\' + m)
      const { data: svcRows } = await db.from('services')
        .select('business_id')
        .eq('status', 'published')
        .or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`)
        .limit(50) as { data: Array<{ business_id: string }> | null }
      tierCounts.tier4_services = svcRows?.length ?? 0
      if (svcRows && svcRows.length > 0) {
        const ids = [...new Set(svcRows.map(r => r.business_id))]
        const { data: rows } = await buildBase().in('id', ids).limit(50) as { data: Business[] | null }
        results = rows ?? []
      }
    }

    // ── Tag merge: add tag-matched businesses missing from tier results ──
    // Businesses with a tag keyword match that weren't caught by vector/FTS
    // get added here. Results are then re-ordered: vector+tag > tag-only >
    // vector-only so explicit tag signals always surface first.
    const vectorIdSet = new Set(results.map(b => b.id))
    const tagOnlyIds = [...tagMatchIds].filter(id => !vectorIdSet.has(id))
    if (tagOnlyIds.length > 0) {
      const { data: tagOnlyRows } = await buildBase()
        .in('id', tagOnlyIds) as { data: Business[] | null }
      const vectorAndTag = results.filter(b => tagMatchIds.has(b.id))
      const vectorOnly  = results.filter(b => !tagMatchIds.has(b.id))
      results = [...vectorAndTag, ...(tagOnlyRows ?? []), ...vectorOnly]
      tierCounts.tag_injected = tagOnlyIds.length
    } else if (tagMatchIds.size > 0) {
      // All tag matches already in results — bubble them to the top
      const withTag    = results.filter(b => tagMatchIds.has(b.id))
      const withoutTag = results.filter(b => !tagMatchIds.has(b.id))
      results = [...withTag, ...withoutTag]
    }

    // Diagnostic: surfaces how many results each tier returned.
    // Helps debug "search returns 0" — usually means the user has no
    // PUBLISHED business or no embeddings populated yet.
    console.log('[search]', JSON.stringify({
      query: queryText,
      tiers: tierCounts,
      final: results.length,
      hardFilters: {
        city: cityHard,
        region: regionHard,
        regionCountriesFound: countriesInRegion?.length ?? null,
        categoryIds: hardCatIds.length,
      },
    }))
  } else {
    // No query — show all listings ranked by tier → endorsements → recency.
    const { data: rows, count } = await buildBase()
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(2000) as { data: Business[] | null; count: number | null }
    results = rows ?? []
    totalCount = count
  }

  // ── Sort / Ranking ──────────────────────────────────────────
  const sort = params.sort ?? 'relevance'
  if (sort === 'alpha') {
    results = [...results].sort((a, b) => a.name.localeCompare(b.name))
  } else if (sort === 'newest') {
    results = [...results].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  } else {
    // 'relevance' mode — apply Member Market tier ranking.
    // Endorsement counts are needed first; fetch them in a single batch.
    const allBusinessIds = results.map(b => b.id)
    const endorseMap = new Map<string, number>()
    if (allBusinessIds.length > 0) {
      const { data: endorseRows } = await db
        .from('endorsements')
        .select('business_id')
        .in('business_id', allBusinessIds) as { data: Array<{ business_id: string }> | null }
      for (const r of endorseRows ?? []) {
        endorseMap.set(r.business_id, (endorseMap.get(r.business_id) ?? 0) + 1)
      }
    }
    results = applyMemberMarketRanking(results, endorseMap)
  }

  // Pull review aggregates for every business we'll render so the
  // card can show "★ 4.6 (12)". Single round-trip, then bucket in JS.
  // No native Postgres-level aggregate via supabase-js client (groupBy
  // isn't supported), so this fetches the rows we need and aggregates
  // here. Results are typically ≤50, reviews per business are small —
  // the round-trip stays under 50ms in practice.
  const allBusinessIds = results.map(b => b.id)
  const reviewStatsByBusiness = new Map<string, { count: number; avg: number }>()
  if (allBusinessIds.length > 0) {
    const { data: reviewRows } = await db
      .from('reviews')
      .select('business_id, rating')
      .in('business_id', allBusinessIds) as {
        data: Array<{ business_id: string; rating: number }> | null
      }
    const sums = new Map<string, { sum: number; count: number }>()
    for (const r of reviewRows ?? []) {
      const cur = sums.get(r.business_id) ?? { sum: 0, count: 0 }
      cur.sum += r.rating
      cur.count += 1
      sums.set(r.business_id, cur)
    }
    for (const [id, s] of sums.entries()) {
      reviewStatsByBusiness.set(id, { count: s.count, avg: s.sum / s.count })
    }
  }

  // Sponsored ads (excludes organic results)
  const organicBusinessIds = results.map((b) => b.id)
  const ads = await pickAds({
    query: queryText,
    categoryIds: hardCatIds,
    city: params.city ?? null,
    country: params.country ?? null,
    page: 'search',
    limit: 2,
    excludeBusinessIds: organicBusinessIds,
  })
  let sponsoredBusinesses: Array<{ business: Business; campaignId: string }> = []
  if (ads.length > 0) {
    const { data: bizRows } = await db.from('businesses').select('*').in('id', ads.map(a => a.business_id)) as { data: Business[] | null }
    sponsoredBusinesses = ads
      .map(a => {
        const biz = (bizRows ?? []).find(b => b.id === a.business_id)
        return biz ? { business: biz, campaignId: a.id } : null
      })
      .filter((x): x is { business: Business; campaignId: string } => x !== null)
  }

  // ── Post-response side effects ──
  // 1. Increment search_appearances for every business shown (organic +
  //    sponsored). Was missing entirely — dashboard always read 0.
  // 2. Populate embeddings for any business that doesn't have one yet
  //    (self-healing semantic search).
  const shownBusinessIds = [
    ...results.map(b => b.id),
    ...sponsoredBusinesses.map(s => s.business.id),
  ]
  after(async () => {
    // Track search_appearances for each shown business
    if (queryText && shownBusinessIds.length > 0) {
      try {
        await Promise.all(shownBusinessIds.map(id =>
          db.rpc('increment_listing_stat', { p_business_id: id, p_stat: 'search_appearances' })
        ))
      } catch (err) {
        console.error('[analytics] search_appearances rpc failed:', err)
      }
    }

    // Embedding self-heal (separate try block so analytics failure doesn't kill backfill)
    if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.OPENAI_API_KEY) {
      try {
        const admin = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } }
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const adminAny = admin as any
        const { data: missing } = await adminAny.rpc('businesses_missing_embeddings', { batch_size: 10 }) as {
          data: Array<{ id: string }> | null
        }
        for (const b of missing ?? []) {
          try { await refreshBusinessEmbedding(adminAny, b.id) } catch (err) { console.error('embed', b.id, err) }
        }
      } catch (err) {
        console.error('post-search backfill failed:', err)
      }
    }
  })

  return (
    <div className="flex gap-8">
      <aside className="hidden lg:block w-56 flex-shrink-0">
        <div className="sticky top-24 bg-card border border-border rounded-xl p-4">
          <Suspense fallback={null}>
            {categories && <FilterPanel categories={categories} />}
          </Suspense>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Mobile-only filter pills. Sidebar above covers desktop. */}
        {categories && (
          <div className="mb-4">
            <MobileFilterBar categories={categories} />
          </div>
        )}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">
              {totalCount ?? results.length}
            </span> {queryText ? 'results' : 'listings'}
            {queryText && <> for <span className="font-semibold text-foreground">&ldquo;{queryText}&rdquo;</span></>}
          </p>
        </div>
        {results.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {(() => {
              const cards: React.ReactNode[] = []
              const organic = results
              let organicIdx = 0
              for (let pos = 0; pos < organic.length + sponsoredBusinesses.length; pos++) {
                if (pos === 0 && sponsoredBusinesses[0]) {
                  cards.push(
                    <SponsoredCard key={`spon-${sponsoredBusinesses[0].campaignId}`}
                      business={sponsoredBusinesses[0].business}
                      campaignId={sponsoredBusinesses[0].campaignId}
                      query={queryText} page="search" />
                  )
                } else if (pos === 4 && sponsoredBusinesses[1]) {
                  cards.push(
                    <SponsoredCard key={`spon-${sponsoredBusinesses[1].campaignId}`}
                      business={sponsoredBusinesses[1].business}
                      campaignId={sponsoredBusinesses[1].campaignId}
                      query={queryText} page="search" />
                  )
                } else if (organic[organicIdx]) {
                  const b = organic[organicIdx]
                  const stats = reviewStatsByBusiness.get(b.id)
                  cards.push(
                    <ListingCard
                      key={b.id}
                      business={{
                        ...b,
                        avg_rating: stats?.avg,
                        review_count: stats?.count,
                      }}
                    />
                  )
                  organicIdx++
                }
              }
              return cards
            })()}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-2xl mb-2">🔍</p>
            <p className="font-semibold">No results found</p>
            <p className="text-sm text-muted-foreground mt-1">Try a different keyword or remove filters</p>
          </div>
        )}

      </div>
    </div>
  )
}

function SearchSkeleton({ query }: { query: string }) {
  return (
    <div className="flex gap-8">
      <aside className="hidden lg:block w-56 flex-shrink-0">
        <div className="sticky top-24 bg-card border border-border rounded-xl p-4 h-64 animate-pulse" />
      </aside>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-block h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">
            Searching{query ? <> for <span className="text-foreground font-medium">&ldquo;{query}&rdquo;</span></> : '…'}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
              <div className="h-32 bg-muted" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-full" />
                <div className="h-3 bg-muted rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-4">
          {params.q ? `Results for "${params.q}"` : 'All Services'}
        </h1>
        <SearchBar defaultValue={params.q ?? ''} />
      </div>
      <Suspense key={params.q ?? ''} fallback={<SearchSkeleton query={params.q ?? ''} />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </div>
  )
}
