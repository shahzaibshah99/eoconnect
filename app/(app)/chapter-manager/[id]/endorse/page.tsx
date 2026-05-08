import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { EndorsePicker } from '@/components/chapter-manager/endorse-picker'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Free-form endorsement search. Useful when the member hasn't yet
 * filled in their chapter_country/city (so they don't appear in the
 * Members list) but the CM still wants to confirm them.
 *
 * The picker calls searchChapterCandidatesForEndorsement which itself
 * narrows by chapter geo — so a CM still can't accidentally endorse
 * someone from a different chapter even if they search broadly.
 */
export default async function ChapterEndorsePage({ params }: PageProps) {
  const { id } = await params
  const chapterId = Number(id)
  if (!Number.isInteger(chapterId)) notFound()

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{chapter.name} · Endorse</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search for a member you can confirm is in this chapter. Your endorsement appears as a supporting signal in the admin verification queue.
        </p>
      </div>
      <EndorsePicker chapterId={chapterId} />
    </div>
  )
}
