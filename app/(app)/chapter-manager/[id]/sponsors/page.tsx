import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { SponsorPocList } from '@/components/chapter-manager/sponsor-poc-list'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Per scope F17: Chapter Manager can nominate a POC (name + email)
 * for each sponsor slot. The POC receives inquiry notifications.
 *
 * Sponsors are businesses in the chapter's geo with verification_tag
 * 'eo_sponsor'. The CM sets the contact email on each sponsor listing;
 * when an inquiry comes in on an eo_sponsor business, the contact
 * email is the one that receives the notification.
 */
export default async function ChapterSponsorsPage({ params }: PageProps) {
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
    .select('id, name, country, city, sponsor_slots')
    .eq('id', chapterId)
    .maybeSingle() as { data: { id: number; name: string; country: string | null; city: string | null; sponsor_slots: number } | null }
  if (!chapter) notFound()

  // Sponsors in this chapter = businesses with eo_sponsor tag + matching geo
  let q = db
    .from('businesses')
    .select('id, name, email, tagline, logo_url, status')
    .eq('verification_tag', 'eo_sponsor')
    .eq('status', 'published')
  if (chapter.country) q = q.ilike('country', `%${chapter.country}%`)
  const { data: sponsors } = await q as {
    data: Array<{ id: string; name: string; email: string | null; tagline: string | null; logo_url: string | null; status: string }> | null
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{chapter.name} · Sponsors</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {sponsors?.length ?? 0} of {chapter.sponsor_slots} sponsor slots active.
          Set a contact email for each sponsor — that email receives inquiry notifications.
        </p>
      </div>
      <SponsorPocList chapterId={chapterId} sponsors={sponsors ?? []} />
    </div>
  )
}
