import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ChaptersList, type ChapterRow } from '@/components/admin/chapters-list'

export const dynamic = 'force-dynamic'

/**
 * Chapter management. super_admin only — chapter creation, manager
 * assignment, and sponsor slot allocation are all platform-level
 * concerns per scope F15.
 *
 * Loads:
 *   - All eo_chapters rows (the canonical reference table)
 *   - All chapter_managers rows joined to the manager's profile
 *   - Member counts per chapter (computed from profiles.chapter_country
 *     + chapter_city) so admins can see chapter density at a glance
 *
 * The matching keys profiles ↔ eo_chapters on (country, city) — same
 * keying that admin_scope_country/city already uses for the existing
 * chapter_admin role. City matches require both ends to be set; if a
 * chapter has no city (national/virtual chapter), it matches members
 * with no chapter_city in that country.
 */
export default async function AdminChaptersPage() {
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

  // Pull chapters and existing manager assignments in parallel.
  const [chaptersRes, managersRes, memberCountsRes] = await Promise.all([
    db
      .from('eo_chapters')
      .select('id, name, region, country, city, virtual, sponsor_slots')
      .order('name', { ascending: true }) as Promise<{
        data: Array<{
          id: number
          name: string
          region: string
          country: string | null
          city: string | null
          virtual: boolean
          sponsor_slots: number
        }> | null
      }>,
    db
      .from('chapter_managers')
      .select(`
        id, chapter_id, member_id, created_at,
        profiles!member_id (full_name, avatar_url, eo_membership_email)
      `) as Promise<{
        data: Array<{
          id: string
          chapter_id: number
          member_id: string
          created_at: string
          profiles: { full_name: string | null; avatar_url: string | null; eo_membership_email: string | null } | null
        }> | null
      }>,
    // Aggregate member counts by (country, city). Doing this server-side
    // means the page can render with totals without loading every profile
    // into the client. RPC would be cleaner but a single bulk read is fine
    // at platform scale (still well under 25K profiles).
    db
      .from('profiles')
      .select('chapter_country, chapter_city') as Promise<{
        data: Array<{ chapter_country: string | null; chapter_city: string | null }> | null
      }>,
  ])

  const chapters = chaptersRes.data ?? []
  const managers = managersRes.data ?? []
  const profiles = memberCountsRes.data ?? []

  // Build (country|city) → count map. Use a sentinel for null city so
  // chapters without a city still get matched against profiles whose
  // chapter_city is null (national/virtual chapters).
  const NULL_CITY = '__none__'
  const countMap = new Map<string, number>()
  for (const p of profiles) {
    if (!p.chapter_country) continue
    const key = `${p.chapter_country}|${p.chapter_city ?? NULL_CITY}`
    countMap.set(key, (countMap.get(key) ?? 0) + 1)
  }

  const rows: ChapterRow[] = chapters.map(c => {
    const key = `${c.country}|${c.city ?? NULL_CITY}`
    const chapterManagers = managers
      .filter(m => m.chapter_id === c.id)
      .map(m => ({
        assignment_id: m.id,
        member_id: m.member_id,
        full_name: m.profiles?.full_name ?? null,
        avatar_url: m.profiles?.avatar_url ?? null,
        email: m.profiles?.eo_membership_email ?? null,
        created_at: m.created_at,
      }))
    return {
      id: c.id,
      name: c.name,
      region: c.region,
      country: c.country,
      city: c.city,
      virtual: c.virtual,
      sponsor_slots: c.sponsor_slots,
      member_count: c.country ? (countMap.get(key) ?? 0) : 0,
      managers: chapterManagers,
    }
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Chapters</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Assign chapter managers and set sponsor slot allocation. {rows.length} chapters total.
        </p>
      </div>
      <ChaptersList rows={rows} />
    </div>
  )
}
