import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { ADS_ENABLED } from '@/lib/feature-flags'
import type { NotificationItem } from '@/components/layout/notifications-button'
import { CURRENT_TERMS_VERSION } from '@/lib/terms-constants'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  // Profile select is split from notifications_seen_at on purpose:
  // if a migration that adds a future profiles column hasn't been
  // applied yet, the WHOLE profile select fails and the layout
  // renders as if the user has no profile at all — broken avatar,
  // missing admin link, etc. Keeping the core profile query stable
  // and pulling forward-compatible fields like notifications_seen_at
  // separately localises the blast radius of a missing column to
  // just the feature that depends on it (notifications bell).
  const [{ data: profile }, { data: convs }, { data: ownedBusinesses }, { count: cmAssignmentCount }] = await Promise.all([
    // Include terms_version so we can gate access below. Wrapping it in
    // the same query avoids an extra round-trip and keeps the profile
    // fetch stable — if the column is missing (migration 032 not applied),
    // it returns null and we skip the gate gracefully.
    supabase.from('profiles').select('id, full_name, avatar_url, eo_chapter, role, status, terms_version').eq('id', user.id).single(),
    db.from('conversations').select('id').contains('participant_ids', [user.id]) as Promise<{ data: Array<{ id: string }> | null }>,
    db.from('businesses').select('id, name').eq('owner_id', user.id) as Promise<{
      data: Array<{ id: string; name: string }> | null
    }>,
    // Count Chapter Manager assignments — a non-zero count means show
    // the CM panel link in the navbar dropdown. Wrapped in a Promise
    // so the whole layout fetch stays in one Promise.all.
    db.from('chapter_managers').select('id', { count: 'exact', head: true }).eq('member_id', user.id) as Promise<{
      count: number | null
    }>,
  ])

  // T&C gate — per scope F06: first login cannot skip terms.
  // If migration 032 hasn't run yet, terms_version comes back undefined
  // (column missing) which we treat as null → gate skipped gracefully.
  // Cast needed because profile.terms_version isn't in the Profile type
  // (backwards-compat: existing types don't include new columns).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acceptedVersion = (profile as any)?.terms_version ?? null
  if (profile && (acceptedVersion === null || acceptedVersion < CURRENT_TERMS_VERSION)) {
    redirect('/terms-accept')
  }

  // Separate, optional fetch for notifications_seen_at. Wrapped so
  // a missing column / unapplied migration just returns null instead
  // of bubbling up and torpedoing the page.
  let notificationsSeenAt: string | null = null
  try {
    const { data: notifProfile } = await db
      .from('profiles')
      .select('notifications_seen_at')
      .eq('id', user.id)
      .single() as { data: { notifications_seen_at: string | null } | null }
    notificationsSeenAt = notifProfile?.notifications_seen_at ?? null
  } catch {
    // Migration 020 not yet applied — silently skip notifications.
    // The bell will show 0 unread until the column exists; profile
    // / admin nav still render correctly because the core profile
    // query above doesn't depend on this.
  }

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

  // Notifications: reviews on the user's businesses + entries from
  // the general-purpose `notifications` table (verification status,
  // future flag dispositions, etc.). Both contribute to the unread
  // badge and the dropdown body, sorted by recency.
  //
  // Anchor with a defensive fallback (now()) for accounts that pre-date
  // migration 020 — those will start with a clean slate.
  let unreadNotifications = 0
  let recentNotifications: NotificationItem[] = []

  const businessIds = (ownedBusinesses ?? []).map(b => b.id)
  const businessNameById = new Map((ownedBusinesses ?? []).map(b => [b.id, b.name]))
  const seenAt = notificationsSeenAt ?? new Date().toISOString()

  // Two parallel reads. Reviews count is gated on owning a listing
  // because reviews-on-zero-listings is structurally impossible.
  // System notifications run for everyone — verification updates fire
  // before the user owns anything.
  const [
    { count: reviewUnread },
    { data: reviewRows },
    { count: systemUnread },
    { data: systemRows },
  ] = await Promise.all([
    businessIds.length > 0
      ? (db
          .from('reviews')
          .select('id', { count: 'exact', head: true })
          .in('business_id', businessIds)
          .gt('created_at', seenAt) as Promise<{ count: number | null }>)
      : Promise.resolve({ count: 0 }),
    businessIds.length > 0
      ? (db
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
          }>)
      : Promise.resolve({ data: [] as Array<{
          id: string; rating: number; body: string | null; business_id: string;
          reviewer_id: string; created_at: string;
          reviewer: { full_name: string } | { full_name: string }[] | null
        }> }),
    db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gt('created_at', seenAt) as Promise<{ count: number | null }>,
    db
      .from('notifications')
      .select('id, type, title, body, link, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5) as Promise<{
        data: Array<{ id: string; type: string; title: string; body: string | null; link: string | null; created_at: string }> | null
      }>,
  ])

  unreadNotifications = (reviewUnread ?? 0) + (systemUnread ?? 0)

  const reviewItems: NotificationItem[] = (reviewRows ?? []).map(r => ({
    kind: 'review' as const,
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

  const systemItems: NotificationItem[] = (systemRows ?? []).map(n => ({
    kind: 'system' as const,
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    created_at: n.created_at,
  }))

  // Merge and slice to top 5 by recency. The bell only ever shows
  // five items at a time; older entries live in /dashboard (eventually
  // a dedicated notifications page).
  recentNotifications = [...reviewItems, ...systemItems]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar
        profile={profile}
        unreadMessages={unreadMessages}
        unreadNotifications={unreadNotifications}
        recentNotifications={recentNotifications}
        ownedBusinessIds={(ownedBusinesses ?? []).map(b => b.id)}
        isChapterManager={(cmAssignmentCount ?? 0) > 0}
        adsEnabled={ADS_ENABLED}
      />
      <main className="flex-1 mx-auto w-full max-w-[1280px] py-8 px-4 md:px-6">
        {children}
      </main>
      <Footer />
    </div>
  )
}
