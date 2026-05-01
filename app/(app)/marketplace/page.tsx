import { createClient } from '@/lib/supabase/server'
import { SearchBar } from '@/components/marketplace/search-bar'
import { TrendingCategories } from '@/components/marketplace/trending-categories'
import { ListingCard } from '@/components/marketplace/listing-card'
import { SponsoredCard } from '@/components/marketplace/sponsored-card'
import { pickAds } from '@/lib/ads/picker'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Business } from '@/types/database'

export default async function MarketplacePage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  // Look up the viewer's chapter so we can split listings into
  // "From your chapter" vs "Across the EO network".
  const { data: { user } } = await supabase.auth.getUser()
  let viewerChapter: { country: string | null; city: string | null; eo_chapter: string | null } | null = null
  if (user) {
    const { data: prof } = await db
      .from('profiles')
      .select('chapter_country, chapter_city, eo_chapter')
      .eq('id', user.id)
      .maybeSingle() as { data: { chapter_country: string | null; chapter_city: string | null; eo_chapter: string | null } | null }
    if (prof?.chapter_country) {
      viewerChapter = { country: prof.chapter_country, city: prof.chapter_city, eo_chapter: prof.eo_chapter }
    }
  }

  const [{ data: categories }, { data: recent }] = await Promise.all([
    db.from('categories').select('*').eq('active', true).order('sort_order'),
    // Pull recent listings WITH the owner's chapter so we can group client-side.
    db.from('businesses')
      .select('*, owner:profiles!owner_id(chapter_country, chapter_city, eo_chapter)')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(viewerChapter ? 24 : 8),
  ])

  type BusinessWithOwner = Business & {
    owner?: { chapter_country: string | null; chapter_city: string | null; eo_chapter: string | null } | null
  }
  const all = (recent ?? []) as BusinessWithOwner[]

  // Split: "your chapter" matches by country (and city if viewer's chapter is city-level).
  //
  // Resolution order for a listing's "country":
  //   1. owner.chapter_country  (preferred — explicit chapter selection)
  //   2. business.country       (fallback — business's own location field)
  // This way listings still group correctly when the owner hasn't onboarded
  // their chapter yet (early adopters, imports, etc.).
  const yourChapterListings: BusinessWithOwner[] = []
  const otherChapterListings: BusinessWithOwner[] = []
  if (viewerChapter) {
    for (const b of all) {
      const country = b.owner?.chapter_country ?? b.country ?? null
      const city = b.owner?.chapter_country ? b.owner.chapter_city : (b.city ?? null)
      const inScope = country === viewerChapter.country &&
        (viewerChapter.city ? city === viewerChapter.city : true)
      if (inScope) yourChapterListings.push(b)
      else otherChapterListings.push(b)
    }
  }
  const yourSlice = yourChapterListings.slice(0, 8)
  const otherSlice = otherChapterListings.slice(0, 8)
  const fallbackRecent = viewerChapter ? [] : all.slice(0, 8)

  // Pull review aggregates for every business we'll render so the
  // listing cards can show their "★ 4.6 (12)" footer. Same shape as
  // /marketplace/search (one round-trip, bucket in JS — supabase-js
  // doesn't expose Postgres group-by aggregates).
  const recentBusinessIds = all.map((b: Business) => b.id)
  const reviewStatsByBusiness = new Map<string, { count: number; avg: number }>()
  if (recentBusinessIds.length > 0) {
    const { data: reviewRows } = await db
      .from('reviews')
      .select('business_id, rating')
      .in('business_id', recentBusinessIds) as {
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
  const withReviews = (b: Business) => {
    const s = reviewStatsByBusiness.get(b.id)
    return { ...b, avg_rating: s?.avg, review_count: s?.count }
  }

  // One sponsored slot at position 0 of the primary list.
  const ads = await pickAds({ page: 'marketplace', limit: 1, excludeBusinessIds: recentBusinessIds })
  let sponsored: { business: Business; campaignId: string } | null = null
  if (ads.length > 0) {
    const { data: bizRows } = await db.from('businesses').select('*').eq('id', ads[0].business_id).maybeSingle() as { data: Business | null }
    if (bizRows) sponsored = { business: bizRows, campaignId: ads[0].id }
  }

  const yourChapterLabel = viewerChapter
    ? (viewerChapter.eo_chapter ?? (viewerChapter.city ? `${viewerChapter.city}, ${viewerChapter.country}` : viewerChapter.country))
    : null

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="text-center py-8">
        <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
          Exclusive to EO Members
        </p>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
          Find trusted member<br />services for your business
        </h1>
        <div className="flex justify-center mt-6">
          <SearchBar />
        </div>
      </section>

      {/* Trending in EO — featured mosaic */}
      {categories && categories.length > 0 && (
        <TrendingCategories categories={categories} />
      )}

      {/* "From your chapter" — only when viewer has a chapter and there are matches */}
      {viewerChapter && yourSlice.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">From {yourChapterLabel}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Members in your EO chapter</p>
            </div>
            <Link href="/marketplace/search?scope=chapter" className="text-sm text-primary hover:underline">
              View All →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {sponsored && (
              <SponsoredCard
                business={sponsored.business}
                campaignId={sponsored.campaignId}
                page="marketplace"
              />
            )}
            {yourSlice.map(b => (
              <ListingCard key={b.id} business={withReviews(b)} />
            ))}
          </div>
        </section>
      )}

      {/* "Across the EO network" — other chapters, or fallback if no viewer chapter */}
      {(otherSlice.length > 0 || fallbackRecent.length > 0) && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">
                {viewerChapter ? 'Across the EO network' : 'Recently Listed'}
              </h2>
              {viewerChapter && (
                <p className="text-xs text-muted-foreground mt-0.5">Listings from other EO chapters</p>
              )}
            </div>
            <Link href="/marketplace/search?sort=newest" className="text-sm text-primary hover:underline">
              View All →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {!viewerChapter && sponsored && (
              <SponsoredCard
                business={sponsored.business}
                campaignId={sponsored.campaignId}
                page="marketplace"
              />
            )}
            {(viewerChapter ? otherSlice : fallbackRecent).map(b => (
              <ListingCard key={b.id} business={withReviews(b)} />
            ))}
          </div>
        </section>
      )}

      {/* CTA Banner */}
      <section className="bg-card border border-border rounded-2xl p-8 text-center">
        <h3 className="text-xl font-bold mb-2">List Your Business</h3>
        <p className="text-muted-foreground text-sm mb-4 max-w-md mx-auto">
          Reach the global EO network. Put your services in front of thousands of high-performing founders.
        </p>
        <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground mb-6">
          <span className="flex items-center gap-1.5"><span className="text-primary">✓</span> EO Member Verification</span>
          <span className="flex items-center gap-1.5"><span className="text-primary">✓</span> Founder-to-Founder Leads</span>
          <span className="flex items-center gap-1.5"><span className="text-primary">✓</span> Zero Transaction Fees</span>
        </div>
        <Link
          href="/dashboard/business/new"
          className={cn(buttonVariants(), 'bg-primary text-primary-foreground font-bold')}
        >
          Apply for Listing
        </Link>
      </section>
    </div>
  )
}
