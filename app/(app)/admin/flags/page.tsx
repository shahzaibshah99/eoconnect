import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FlagsQueue, type FlagGroup, type FlagRow } from '@/components/admin/flags-queue'

export const dynamic = 'force-dynamic'

/**
 * Flag review queue. Groups individual flag rows by (target_type, target_id)
 * so the admin sees one entry per incident with all reporters listed —
 * matches scope F06's "3-flag auto-escalation" model where the count is
 * what matters, not the individual rows.
 *
 * Listings and reviews resolve their target name via FK joins. Posts /
 * responses / messages don't have tables yet (F04/F05) — when they
 * ship, extend the joins below and the disposition action's owner walk
 * in actions/flags.ts.
 */
export default async function AdminFlagsPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: 'member' | 'chapter_admin' | 'super_admin' } | null }

  if (!me || !['chapter_admin', 'super_admin'].includes(me.role)) redirect('/admin')

  const { data: rows } = await db
    .from('flags')
    .select(`
      id, target_type, target_id, type, reason, status, created_at,
      reporter:profiles!reporter_id (full_name, avatar_url)
    `)
    .order('created_at', { ascending: false })
    .limit(500) as { data: FlagRow[] | null }

  // Group by (target_type, target_id). Sort groups by latest open flag's
  // recency so freshly-flagged incidents float to the top.
  const groupMap = new Map<string, FlagGroup>()
  for (const r of rows ?? []) {
    const key = `${r.target_type}:${r.target_id}`
    let g = groupMap.get(key)
    if (!g) {
      g = {
        target_type: r.target_type,
        target_id: r.target_id,
        flags: [],
        open_count: 0,
        latest_at: r.created_at,
        target_name: null,
      }
      groupMap.set(key, g)
    }
    g.flags.push(r)
    if (r.status === 'open') g.open_count++
    if (r.created_at > g.latest_at) g.latest_at = r.created_at
  }
  const groups = Array.from(groupMap.values())

  // Hydrate target_name where the target_type has a known table.
  const listingIds = groups.filter(g => g.target_type === 'listing').map(g => g.target_id)
  const reviewIds = groups.filter(g => g.target_type === 'review').map(g => g.target_id)
  const [listingsRes, reviewsRes] = await Promise.all([
    listingIds.length
      ? db.from('businesses').select('id, name').in('id', listingIds) as Promise<{
          data: Array<{ id: string; name: string }> | null
        }>
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    reviewIds.length
      ? db.from('reviews').select('id, business_id, businesses!business_id(name)').in('id', reviewIds) as Promise<{
          data: Array<{ id: string; business_id: string; businesses?: { name: string } }> | null
        }>
      : Promise.resolve({ data: [] as Array<{ id: string; business_id: string; businesses?: { name: string } }> }),
  ])
  const listingNames = new Map((listingsRes.data ?? []).map(b => [b.id, b.name]))
  const reviewNames = new Map(
    (reviewsRes.data ?? []).map(r => [r.id, `Review on ${r.businesses?.name ?? 'unknown'}`])
  )
  for (const g of groups) {
    if (g.target_type === 'listing') g.target_name = listingNames.get(g.target_id) ?? null
    if (g.target_type === 'review') g.target_name = reviewNames.get(g.target_id) ?? null
  }

  groups.sort((a, b) => {
    // Open groups first, then by escalation severity, then by recency.
    if (a.open_count > 0 !== b.open_count > 0) return b.open_count - a.open_count
    if (a.open_count !== b.open_count) return b.open_count - a.open_count
    return b.latest_at.localeCompare(a.latest_at)
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Flag review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Member-reported flags grouped by target. 3+ open flags = auto-escalation.
        </p>
      </div>
      <FlagsQueue groups={groups} />
    </div>
  )
}
