import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { ChapterMembersList, type ChapterMember } from '@/components/chapter-manager/chapter-members-list'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Read-only members list for a single chapter the CM manages.
 *
 * Matching key: profiles.chapter_country + chapter_city against the
 * chapter's country/city. Same pattern admin scope uses (migration 008).
 *
 * Each row shows verification state and any endorsement THIS CM has
 * already written, so the CM can endorse anyone they haven't yet
 * with a single click — no typeahead needed for known members.
 */
export default async function ChapterMembersPage({ params }: PageProps) {
  const { id } = await params
  const chapterId = Number(id)
  if (!Number.isInteger(chapterId)) notFound()

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Verify the user manages this chapter — defence-in-depth alongside
  // the layout's broader gate.
  const { data: assignment } = await db
    .from('chapter_managers')
    .select('id')
    .eq('member_id', user.id)
    .eq('chapter_id', chapterId)
    .maybeSingle() as { data: { id: string } | null }
  if (!assignment) redirect('/chapter-manager')

  const { data: chapter } = await db
    .from('eo_chapters')
    .select('id, name, country, city')
    .eq('id', chapterId)
    .maybeSingle() as { data: { id: number; name: string; country: string | null; city: string | null } | null }
  if (!chapter) notFound()

  // Pull members in this chapter's geo. Cap at 500 — chapters average
  // 50-150 members; anything close to 500 is unusual and can be paginated
  // later if needed.
  let memberQuery = db
    .from('profiles')
    .select('id, full_name, avatar_url, eo_membership_email, verification_tag, created_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (chapter.country) memberQuery = memberQuery.eq('chapter_country', chapter.country)
  if (chapter.city) memberQuery = memberQuery.eq('chapter_city', chapter.city)

  const { data: members } = await memberQuery as {
    data: Array<{
      id: string
      full_name: string | null
      avatar_url: string | null
      eo_membership_email: string | null
      verification_tag: string
      created_at: string
    }> | null
  }

  // Pull this CM's existing endorsements for this chapter so the UI can
  // show "endorsed by you" without an extra round-trip per row.
  const { data: myEndorsements } = await db
    .from('chapter_endorsements')
    .select('id, member_id, note')
    .eq('chapter_id', chapterId)
    .eq('endorsed_by', user.id) as {
      data: Array<{ id: string; member_id: string; note: string | null }> | null
    }
  const endorseMap = new Map(
    (myEndorsements ?? []).map(e => [e.member_id, { id: e.id, note: e.note }])
  )

  const rows: ChapterMember[] = (members ?? []).map(m => ({
    ...m,
    endorsement: endorseMap.get(m.id) ?? null,
  }))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{chapter.name} · Members</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {rows.length} {rows.length === 1 ? 'member' : 'members'}. Endorse anyone you can confirm is in your chapter.
        </p>
      </div>
      <ChapterMembersList chapterId={chapterId} members={rows} />
    </div>
  )
}
