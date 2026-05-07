import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SpotlightSchedule, type SpotlightRow } from '@/components/admin/spotlight-schedule'

export const dynamic = 'force-dynamic'

/**
 * Spotlight schedule. super_admin only.
 *
 * Lists upcoming and past spotlight slots grouped by month, with
 * inline scheduling (App Admin direct) and approve/reject actions
 * for any pending nominations from chapter managers (when the CM
 * panel ships).
 */
export default async function AdminSpotlightPage() {
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

  if (me?.role !== 'super_admin') redirect('/admin')

  const { data: rows } = await db
    .from('spotlight_schedule')
    .select(`
      id, business_id, month, type, status, rejection_reason, created_at,
      businesses!business_id (name, city, country, logo_url),
      nominator:profiles!nominated_by (full_name),
      approver:profiles!approved_by (full_name)
    `)
    .order('month', { ascending: false })
    .limit(300) as { data: SpotlightRow[] | null }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Spotlight schedule</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Schedule featured listings by month. Direct scheduling is auto-approved; chapter manager
          nominations land here for review.
        </p>
      </div>
      <SpotlightSchedule rows={rows ?? []} />
    </div>
  )
}
