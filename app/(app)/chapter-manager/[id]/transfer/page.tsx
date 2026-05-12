import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { TransferListingForm } from '@/components/chapter-manager/transfer-listing-form'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Per scope F17: CM can transfer a listing they created to a member
 * by entering their email. A claim link is sent and once the member
 * claims, the CM loses edit access. Every transfer is logged in
 * events_log with created_by, invite_sent_at, claimed_by, claimed_at.
 */
export default async function ChapterTransferPage({ params }: PageProps) {
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
    .select('id, name')
    .eq('id', chapterId)
    .maybeSingle() as { data: { id: number; name: string } | null }
  if (!chapter) notFound()

  // Listings the CM created (owns) that haven't been claimed yet.
  const { data: listings } = await db
    .from('businesses')
    .select('id, name, email, status, is_pre_populated, claimed_at')
    .eq('owner_id', user.id)
    .is('claimed_at', null)
    .order('created_at', { ascending: false }) as {
    data: Array<{ id: string; name: string; email: string | null; status: string; is_pre_populated: boolean; claimed_at: string | null }> | null
  }

  // Also pull pre-populated listings with no owner (created via CSV for this CM's chapter)
  const { data: unclaimedListings } = await db
    .from('businesses')
    .select('id, name, email, status, is_pre_populated, claimed_at')
    .is('owner_id', null)
    .eq('is_pre_populated', true)
    .order('created_at', { ascending: false })
    .limit(50) as {
    data: Array<{ id: string; name: string; email: string | null; status: string; is_pre_populated: boolean; claimed_at: string | null }> | null
  }

  const allListings = [
    ...(listings ?? []),
    ...(unclaimedListings ?? []).filter(u => !(listings ?? []).find(l => l.id === u.id)),
  ]

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold">{chapter.name} · Transfer Listings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Send a claim link to a member so they can take ownership of a listing you created on their behalf.
          Once claimed, you lose edit access.
        </p>
      </div>
      <TransferListingForm chapterId={chapterId} listings={allListings} />
    </div>
  )
}
