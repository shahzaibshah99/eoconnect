import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Building2, Users, BadgeCheck, MapPin } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface ChapterCard {
  chapter_id: number
  name: string
  country: string | null
  city: string | null
  member_count: number
  listing_count: number
  endorsement_count: number
}

/**
 * CM dashboard. Lists every chapter the current user manages with
 * top-line counts so they can pick where to act.
 *
 * Stats are computed via three filtered queries — fine at chapter
 * scale (a few hundred members per chapter at most). At platform
 * scale the (country, city) join keying matches existing admin
 * scope semantics.
 */
export default async function ChapterManagerHome() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: assignments } = await db
    .from('chapter_managers')
    .select('chapter_id, eo_chapters!chapter_id (id, name, country, city)')
    .eq('member_id', user.id) as {
      data: Array<{
        chapter_id: number
        eo_chapters: { id: number; name: string; country: string | null; city: string | null } | null
      }> | null
    }

  if (!assignments || assignments.length === 0) redirect('/dashboard')

  // Build per-chapter stats. Three counts each:
  //   - members in (country, city)
  //   - businesses owned by those members
  //   - chapter_endorsements rows for this chapter
  const cards: ChapterCard[] = await Promise.all(
    assignments.map(async (a): Promise<ChapterCard> => {
      const c = a.eo_chapters
      if (!c) {
        return {
          chapter_id: a.chapter_id,
          name: '(missing chapter)',
          country: null,
          city: null,
          member_count: 0,
          listing_count: 0,
          endorsement_count: 0,
        }
      }
      let memberQuery = db.from('profiles').select('id', { count: 'exact', head: true })
      if (c.country) memberQuery = memberQuery.eq('chapter_country', c.country)
      if (c.city) memberQuery = memberQuery.eq('chapter_city', c.city)

      const [{ count: memberCount }, { count: listingCount }, { count: endorseCount }] = await Promise.all([
        memberQuery as unknown as Promise<{ count: number | null }>,
        // Listings owned by members in this chapter — matches via owner→profile→geo.
        // We do this in two steps because PostgREST can't join on a filtered subquery.
        (async () => {
          let q = db.from('profiles').select('id')
          if (c.country) q = q.eq('chapter_country', c.country)
          if (c.city) q = q.eq('chapter_city', c.city)
          const { data: ids } = await q as { data: Array<{ id: string }> | null }
          if (!ids || !ids.length) return { count: 0 } as { count: number | null }
          const { count } = await db
            .from('businesses')
            .select('id', { count: 'exact', head: true })
            .in('owner_id', ids.map(p => p.id)) as { count: number | null }
          return { count: count ?? 0 }
        })(),
        db
          .from('chapter_endorsements')
          .select('id', { count: 'exact', head: true })
          .eq('chapter_id', a.chapter_id) as unknown as Promise<{ count: number | null }>,
      ])

      return {
        chapter_id: a.chapter_id,
        name: c.name,
        country: c.country,
        city: c.city,
        member_count: memberCount ?? 0,
        listing_count: listingCount ?? 0,
        endorsement_count: endorseCount ?? 0,
      }
    })
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Chapter Manager</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage members, endorse new joiners, and submit CSV rosters for {cards.length === 1 ? 'your chapter' : `${cards.length} chapters`}.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map(card => <ChapterCardItem key={card.chapter_id} card={card} />)}
      </section>

      <section className="bg-muted/30 border border-border rounded-xl p-4 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">What you can do here</p>
        <ul className="list-disc pl-4 space-y-1">
          <li><strong className="text-foreground">Endorse members</strong> — confirm someone is in your chapter so they get an extra trust signal in the verification queue.</li>
          <li><strong className="text-foreground">View members</strong> — see who&apos;s in your chapter and their verification state.</li>
          <li><strong className="text-foreground">Submit CSV imports</strong> — upload a roster to onboard the rest of your chapter. Submissions are reviewed by App Admin before going live.</li>
        </ul>
        <p className="pt-1 italic">
          Profile creation and ownership transfer arrive when the claim flow ships.
        </p>
      </section>
    </div>
  )
}

function ChapterCardItem({ card }: { card: ChapterCard }) {
  const subtitle = [card.country, card.city].filter(Boolean).join(' · ') || '—'
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">{card.name}</h2>
        </div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Members" value={card.member_count} icon={<Users className="h-3.5 w-3.5" />} />
        <Stat label="Listings" value={card.listing_count} icon={<Building2 className="h-3.5 w-3.5" />} />
        <Stat label="Endorsed" value={card.endorsement_count} icon={<BadgeCheck className="h-3.5 w-3.5" />} />
      </div>
      <div className="flex gap-2 pt-1">
        <Link
          href={`/chapter-manager/${card.chapter_id}/members`}
          className="flex-1 text-center text-xs font-medium bg-muted hover:bg-muted/80 px-3 py-2 rounded-lg"
        >
          Members
        </Link>
        <Link
          href={`/chapter-manager/${card.chapter_id}/endorse`}
          className="flex-1 text-center text-xs font-medium bg-muted hover:bg-muted/80 px-3 py-2 rounded-lg"
        >
          Endorse
        </Link>
        <Link
          href={`/chapter-manager/${card.chapter_id}/imports`}
          className="flex-1 text-center text-xs font-medium bg-muted hover:bg-muted/80 px-3 py-2 rounded-lg"
        >
          CSV
        </Link>
      </div>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-muted/40 rounded-lg p-2">
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-lg font-bold mt-0.5">{value.toLocaleString()}</p>
    </div>
  )
}
