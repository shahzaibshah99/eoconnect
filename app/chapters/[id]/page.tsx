import { createClient as createServiceClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MapPin, Users, Briefcase, MessageSquare, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * F10: Public chapter co-branded landing page.
 *
 * Per scope: aggregate stats only — no individual member names.
 * CTA: "Verify membership to access."
 * Stats: listing count by tag type, active categories,
 * bulletin board activity this month, sponsor logos.
 *
 * No auth required — this is a public marketing page.
 */

export const revalidate = 86400 // nightly revalidation via ISR

interface PageProps {
  params: Promise<{ id: string }>
}

function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default async function ChapterLandingPage({ params }: PageProps) {
  const { id } = await params
  const chapterId = Number(id)
  if (!Number.isInteger(chapterId) || isNaN(chapterId)) notFound()

  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  const { data: chapter } = await dbAny
    .from('eo_chapters')
    .select('id, name, region, country, city, sponsor_slots')
    .eq('id', chapterId)
    .maybeSingle() as {
    data: { id: number; name: string; region: string; country: string | null; city: string | null; sponsor_slots: number } | null
  }
  if (!chapter) notFound()

  // Pull member counts by verification tag for this chapter's geo.
  let memberQuery = dbAny
    .from('profiles')
    .select('verification_tag')
  if (chapter.country) memberQuery = memberQuery.eq('chapter_country', chapter.country)
  if (chapter.city) memberQuery = memberQuery.eq('chapter_city', chapter.city)
  const { data: members } = await memberQuery as { data: Array<{ verification_tag: string }> | null }

  const tagCounts: Record<string, number> = {}
  for (const m of members ?? []) {
    const t = m.verification_tag ?? 'unverified'
    tagCounts[t] = (tagCounts[t] ?? 0) + 1
  }
  const totalVerified = Object.entries(tagCounts)
    .filter(([t]) => t !== 'unverified')
    .reduce((sum, [, c]) => sum + c, 0)
  const totalMembers = Object.values(tagCounts).reduce((s, c) => s + c, 0)

  // Active listings count
  let bizQuery = dbAny
    .from('businesses')
    .select('id, category_ids, verification_tag', { count: 'exact' })
    .eq('status', 'published')
  const { data: bizRows, count: totalListings } = await bizQuery as {
    data: Array<{ id: string; category_ids: string[] | null; verification_tag: string }> | null
    count: number | null
  }

  // Category activity (top 5 by listing count)
  const catMap = new Map<string, number>()
  for (const b of bizRows ?? []) {
    for (const cid of b.category_ids ?? []) {
      catMap.set(cid, (catMap.get(cid) ?? 0) + 1)
    }
  }
  const topCatIds = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id)
  let topCategories: Array<{ id: string; name: string }> = []
  if (topCatIds.length > 0) {
    const { data: cats } = await dbAny
      .from('categories')
      .select('id, name')
      .in('id', topCatIds) as { data: Array<{ id: string; name: string }> | null }
    topCategories = cats ?? []
  }

  // Bulletin board activity this month
  const thisMonthStart = new Date()
  thisMonthStart.setDate(1)
  thisMonthStart.setHours(0, 0, 0, 0)
  const { count: bulletinCount } = await dbAny
    .from('bulletin_posts')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', thisMonthStart.toISOString()) as { count: number | null }

  // Sponsor logos (businesses with eo_sponsor tag in this chapter)
  let sponsorQuery = dbAny
    .from('businesses')
    .select('id, name, logo_url')
    .eq('verification_tag', 'eo_sponsor')
    .eq('status', 'published')
  if (chapter.country) sponsorQuery = sponsorQuery.ilike('country', `%${chapter.country}%`)
  const { data: sponsors } = await sponsorQuery as {
    data: Array<{ id: string; name: string; logo_url: string | null }> | null
  }

  const location = [chapter.city, chapter.country].filter(Boolean).join(', ')
  const slug = slugifyName(chapter.name)

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
        <div className="max-w-4xl mx-auto px-6 py-16 md:py-24">
          <p className="text-sm font-medium opacity-70 mb-3">Member Market · EO Chapter</p>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">{chapter.name}</h1>
          {location && (
            <p className="flex items-center gap-1.5 text-base opacity-80 mb-8">
              <MapPin className="h-4 w-4" /> {location}
            </p>
          )}
          <div className="flex flex-wrap gap-6 mb-10">
            <div>
              <p className="text-3xl font-bold">{totalVerified}</p>
              <p className="text-sm opacity-70">Verified members</p>
            </div>
            <div>
              <p className="text-3xl font-bold">{totalListings ?? 0}</p>
              <p className="text-sm opacity-70">Active listings</p>
            </div>
            <div>
              <p className="text-3xl font-bold">{bulletinCount ?? 0}</p>
              <p className="text-sm opacity-70">Posts this month</p>
            </div>
          </div>
          <Link
            href="/login"
            className={cn(buttonVariants({ size: 'lg' }), 'bg-white text-primary hover:bg-white/90 font-bold')}
          >
            Verify membership to access
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-12">
        {/* Member breakdown */}
        <section>
          <h2 className="text-xl font-bold mb-4">Chapter members</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(tagCounts)
              .filter(([t]) => t !== 'unverified')
              .sort((a, b) => b[1] - a[1])
              .map(([tag, count]) => (
                <div key={tag} className="bg-card border border-border rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-xs text-muted-foreground mt-1 capitalize">
                    {tag.replace(/_/g, ' ').replace('eo ', '')}
                  </p>
                </div>
              ))}
            {tagCounts.unverified > 0 && (
              <div className="bg-card border border-border rounded-xl p-4 text-center opacity-60">
                <p className="text-2xl font-bold">{tagCounts.unverified}</p>
                <p className="text-xs text-muted-foreground mt-1">Pending verification</p>
              </div>
            )}
          </div>
        </section>

        {/* Top categories */}
        {topCategories.length > 0 && (
          <section>
            <h2 className="text-xl font-bold mb-4">Active categories</h2>
            <div className="flex flex-wrap gap-2">
              {topCategories.map(cat => (
                <Badge key={cat.id} variant="secondary" className="text-sm px-3 py-1">
                  {cat.name}
                </Badge>
              ))}
            </div>
          </section>
        )}

        {/* Sponsors */}
        {sponsors && sponsors.length > 0 && (
          <section>
            <h2 className="text-xl font-bold mb-4">Chapter sponsors</h2>
            <div className="flex flex-wrap gap-4 items-center">
              {sponsors.map(s => (
                <div key={s.id} className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-3">
                  {s.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.logo_url} alt={s.name} className="h-8 w-8 object-contain rounded" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {s.name.charAt(0)}
                    </div>
                  )}
                  <span className="text-sm font-medium">{s.name}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="bg-primary/5 border border-primary/20 rounded-2xl p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">You&apos;re in EO {chapter.name}?</h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Verify your membership to access the full directory, post business needs, and connect with fellow members.
          </p>
          <Link href="/login" className={cn(buttonVariants({ size: 'lg' }), 'font-bold')}>
            Verify membership — it&apos;s free
          </Link>
        </section>
      </div>

      <footer className="border-t border-border mt-16 py-6 text-center text-xs text-muted-foreground">
        Member Market · EO {chapter.name} · <Link href="/" className="hover:underline">member.market</Link>
      </footer>
    </div>
  )
}
