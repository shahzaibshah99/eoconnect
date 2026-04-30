import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { format, formatDistanceToNow } from 'date-fns'
import { Users, Building2, MessageSquareWarning } from 'lucide-react'
import { describeChapterScope } from '@/lib/chapter-scope'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const RECENT_MEMBERS_LIMIT = 12

const MEMBERSHIP_LABEL: Record<string, string> = {
  current_member: 'Current',
  alumni: 'Alumni',
  accelerator: 'Accelerator',
}

/**
 * Admin overview page.
 *
 * Replaces the previous /admin → /admin/members redirect. Two reasons for
 * an actual overview rather than a deep-link:
 *   1. Shahzaib (Mkt/Sales TL) asked for visibility on who's recently
 *      joined. A "Recently Joined" widget at the top of /admin makes it
 *      the first thing chapter and super admins see when they land.
 *   2. The sidebar already has the deep links; landing on a content-less
 *      redirect was a wasted click.
 *
 * Chapter admins see only members within their assigned country/city
 * scope; super admins see everyone. Same scoping rule as /admin/members.
 */
export default async function AdminOverviewPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await db
    .from('profiles')
    .select('role, admin_scope_country, admin_scope_city')
    .eq('id', user.id)
    .single() as {
      data: {
        role: 'chapter_admin' | 'super_admin'
        admin_scope_country: string | null
        admin_scope_city: string | null
      } | null
    }

  // Layout already redirected non-admins to /dashboard; this guard is
  // belt-and-braces in case the layout ever moves.
  if (!me) redirect('/dashboard')

  // Recently joined: latest N profile rows ordered by created_at desc.
  let recentQuery = db
    .from('profiles')
    .select('id, full_name, eo_chapter, eo_membership_email, eo_membership_type, avatar_url, status, created_at, chapter_country, chapter_city')
    .order('created_at', { ascending: false })
    .limit(RECENT_MEMBERS_LIMIT)
  // Chapter admins are scoped to their assigned country/city. Super
  // admins see everyone.
  if (me.role === 'chapter_admin' && me.admin_scope_country) {
    recentQuery = recentQuery.eq('chapter_country', me.admin_scope_country)
    if (me.admin_scope_city) recentQuery = recentQuery.eq('chapter_city', me.admin_scope_city)
  }

  const { data: recent } = await recentQuery as {
    data: Array<{
      id: string
      full_name: string
      eo_chapter: string | null
      eo_membership_email: string | null
      eo_membership_type: 'current_member' | 'alumni' | 'accelerator' | null
      avatar_url: string | null
      status: 'pending' | 'active' | 'suspended'
      created_at: string
    }> | null
  }

  // Lifetime totals shown in the heading. Use head:true count-only
  // queries — the rows themselves aren't needed here, just the number.
  const totalMembersQuery = db.from('profiles').select('id', { count: 'exact', head: true })
  const totalListingsQuery = db.from('businesses').select('id', { count: 'exact', head: true })
  const flaggedReviewsQuery = db.from('reviews').select('id', { count: 'exact', head: true }).eq('flagged', true)

  // Chapter admins' totals are scoped same as the recent list, so the
  // numbers match what they'd see clicking through to the deep pages.
  const scopedMembers = me.role === 'chapter_admin' && me.admin_scope_country
    ? me.admin_scope_city
      ? totalMembersQuery.eq('chapter_country', me.admin_scope_country).eq('chapter_city', me.admin_scope_city)
      : totalMembersQuery.eq('chapter_country', me.admin_scope_country)
    : totalMembersQuery

  const [{ count: totalMembers }, { count: totalListings }, { count: flaggedReviews }] = await Promise.all([
    scopedMembers as unknown as { count: number | null },
    totalListingsQuery as unknown as { count: number | null },
    flaggedReviewsQuery as unknown as { count: number | null },
  ])

  const recentMembers = recent ?? []

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Admin Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {me.role === 'chapter_admin'
            ? `Scoped to ${describeChapterScope({ country: me.admin_scope_country, city: me.admin_scope_city })}.`
            : 'All members and listings across all chapters.'}
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Members" value={totalMembers ?? 0} icon={<Users className="h-5 w-5" />} href="/admin/members" />
        <StatCard label="Listings" value={totalListings ?? 0} icon={<Building2 className="h-5 w-5" />} href="/admin/listings" />
        <StatCard label="Flagged Reviews" value={flaggedReviews ?? 0} icon={<MessageSquareWarning className="h-5 w-5" />} href="/admin/reviews" />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Recently Joined</h2>
          <Link href="/admin/members" className="text-xs text-primary hover:underline">
            View all members →
          </Link>
        </div>

        {recentMembers.length === 0 ? (
          <div className="text-sm text-muted-foreground bg-card border border-border rounded-xl p-6 text-center">
            No members in your scope yet.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
            {recentMembers.map(m => (
              <div key={m.id} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors">
                <Avatar className="h-9 w-9 flex-shrink-0">
                  <AvatarImage src={m.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                    {(m.full_name ?? '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{m.full_name || '—'}</p>
                    {m.eo_membership_type && (
                      <Badge variant="secondary" className="text-[10px]">
                        {MEMBERSHIP_LABEL[m.eo_membership_type] ?? m.eo_membership_type}
                      </Badge>
                    )}
                    <StatusBadge status={m.status} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {[m.eo_chapter, m.eo_membership_email].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 hidden sm:block">
                  <p className="text-xs text-muted-foreground" title={format(new Date(m.created_at), 'PPpp')}>
                    {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({
  label, value, icon, href,
}: { label: string; value: number; icon: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="block bg-card border border-border rounded-xl p-4 hover:border-primary transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 text-primary p-2">{icon}</div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-xl font-bold mt-0.5">{value.toLocaleString()}</p>
        </div>
      </div>
    </Link>
  )
}

function StatusBadge({ status }: { status: 'pending' | 'active' | 'suspended' }) {
  const styles: Record<string, string> = {
    active: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
    pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
    suspended: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  }
  return (
    <Badge className={cn('border capitalize text-[10px]', styles[status])}>{status}</Badge>
  )
}
