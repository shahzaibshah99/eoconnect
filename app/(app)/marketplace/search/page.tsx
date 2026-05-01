import { Suspense } from 'react'
import { after } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { SearchBar } from '@/components/marketplace/search-bar'
import { FilterPanel } from '@/components/marketplace/filter-panel'
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
        // No EO chapters in this region (impossible with current
        // seed data, but defensive). Short-circuit to zero rows
        // rather than silently drop the filter.
        q = q.eq('id', '00000000-0000-0000-0000-000000000000')
      } else {
        // OR each country with ILIKE so casing/whitespace differences
        // ("United States" vs "united states") don't miss matches.
        // PostgREST's .or() takes a comma-joined string of conditions.
        // Country names with commas don't appear in the eo_chapters
        // seed, but escape them defensively just in case.
        const orFilter = countriesInRegion
          .map(c => `country.ilike.${c.replace(/,/g, '\\,')}`)
          .join(',')
        q = q.or(orFilter)
      }
    }
    if (hardCatIds.length > 0) q = q.overlaps('category_ids', hardCatIds)
    return q
  }

  let results: Business[] = []
  const queryText = params.q?.trim()
  const tierCounts: Record<string, number> = {}

  if (queryText) {
    // PERFORMANCE: parser + embedding run in parallel (used to be sequential
    // and added ~1.2s to every search). Embedding always uses the raw query
    // — we lose the small benefit of focused text but cut latency in half.
    const [parsed, queryEmbedding] = await Promise.all([
      categories ? parseSearchQuery(queryText, categories) : Promise.resolve(null),
      getEmbedding(queryText),
    ])
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
        // Raised from 0.20 (which let "ai consultancy" match real estate
        // searches because both are "Australian businesses"). 0.45 is a
        // pragmatic threshold for text-embedding-3-small cosine distance.
        min_similarity: 0.45,
      }) as { data: Array<{ id: string; similarity: number }> | null; error: { message: string } | null }
      if (rpcErr) tierCounts.vector_rpc_error = 1
      tierCounts.tier1_vector_raw = matches?.length ?? 0

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
    // No query — list mode (newest first, respecting filters)
    const { data: rows } = await buildBase()
      .order('created_at', { ascending: false })
      .limit(50) as { data: Business[] | null }
    results = rows ?? []
  }

  // Sort overrides
  const sort = params.sort ?? 'relevance'
  if (sort === 'alpha') {
    results = [...results].sort((a, b) => a.name.localeCompare(b.name))
  } else if (sort === 'newest') {
    results = [...results].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  }
  // 'relevance' keeps the embedding-similarity ordering.

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
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{results.length}</span> results
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
                  cards.push(<ListingCard key={b.id} business={b} />)
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
