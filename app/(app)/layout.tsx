import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { ADS_ENABLED } from '@/lib/feature-flags'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [{ data: profile }, { data: convs }, { data: ownedBusinesses }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, avatar_url, eo_chapter, role, status, notifications_seen_at').eq('id', user.id).single(),
    db.from('conversations').select('id').contains('participant_ids', [user.id]) as Promise<{ data: Array<{ id: string }> | null }>,
    db.from('businesses').select('id, name').eq('owner_id', user.id) as Promise<{
      data: Array<{ id: string; name: string }> | null
    }>,
  ])

  let unreadMessages = 0
  if (convs && convs.length > 0) {
    const { count } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', convs.map(c => c.id))
      .neq('sender_id', user.id)
      .is('read_at', null) as { count: number | null }
    unreadMessages = count ?? 0
  }

  // Notifications: reviews left on the user's businesses since the
  // last time they opened the bell. Anchor with a defensive fallback
  // (now()) for accounts that pre-date migration 020 — those will
  // start with a clean slate.
  let unreadNotifications = 0
  let recentNotifications: Array<{
    id: string
    rating: number
    body: string | null
    business_id: string
    business_name: string
    reviewer_name: string
    created_at: string
  }> = []
  if (ownedBusinesses && ownedBusinesses.length > 0) {
    const businessIds = ownedBusinesses.map(b => b.id)
    const businessNameById = new Map(ownedBusinesses.map(b => [b.id, b.name]))
    // Cast through unknown — the Database generic doesn't yet know
    // about notifications_seen_at (added in migration 020). Once
    // types are regenerated this cast can drop.
    const seenAt = ((profile as unknown as { notifications_seen_at?: string | null })?.notifications_seen_at) ?? new Date().toISOString()
    // Pull the latest reviews on user's businesses across two
    // queries: count of unread (since seen_at) for the badge, plus
    // the 5 most-recent reviews for the dropdown body.
    const [{ count: unreadCount }, { data: recentRows }] = await Promise.all([
      db
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .in('business_id', businessIds)
        .gt('created_at', seenAt) as Promise<{ count: number | null }>,
      db
        .from('reviews')
        .select('id, rating, body, business_id, reviewer_id, created_at, reviewer:profiles!reviewer_id(full_name)')
        .in('business_id', businessIds)
        .order('created_at', { ascending: false })
        .limit(5) as Promise<{
          data: Array<{
            id: string; rating: number; body: string | null; business_id: string;
            reviewer_id: string; created_at: string;
            reviewer: { full_name: string } | { full_name: string }[] | null
          }> | null
        }>,
    ])
    unreadNotifications = unreadCount ?? 0
    recentNotifications = (recentRows ?? []).map(r => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      business_id: r.business_id,
      business_name: businessNameById.get(r.business_id) ?? 'Listing',
      // PostgREST !inner(...) returns either an array or a single
      // object depending on the join cardinality. profiles to
      // reviews is many-to-one so practically it's the object,
      // but the typed result still allows array form — defend
      // against both.
      reviewer_name: Array.isArray(r.reviewer)
        ? (r.reviewer[0]?.full_name ?? 'A member')
        : (r.reviewer?.full_name ?? 'A member'),
      created_at: r.created_at,
    }))
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar
        profile={profile}
        unreadMessages={unreadMessages}
        unreadNotifications={unreadNotifications}
        recentNotifications={recentNotifications}
        ownedBusinessIds={(ownedBusinesses ?? []).map(b => b.id)}
        adsEnabled={ADS_ENABLED}
      />
      <main className="flex-1 mx-auto w-full max-w-[1280px] py-8 px-4 md:px-6">
        {children}
      </main>
      <Footer />
    </div>
  )
}
