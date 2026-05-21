import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { VerificationsQueue, type VerificationRow } from '@/components/admin/verifications-queue'

export const dynamic = 'force-dynamic'

/**
 * Verification queue. super_admin only — verification is a platform-wide
 * trust signal, not chapter-scoped (per scope doc F15).
 *
 * Joins to profiles for the submitter context (name, email, chapter,
 * current tag, tenant). Order is pending first, then most recent.
 */
export default async function AdminVerificationsPage() {
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
    .from('verifications')
    .select(`
      id, member_id, tenant_id, method, screenshot_url, linkedin_url,
      linkedin_signal, status, rejection_reason, reviewed_at, created_at,
      claimed_tag,
      profiles!member_id (
        full_name, avatar_url, eo_chapter, eo_membership_email,
        verification_tag, tenant_id
      )
    `)
    .order('status', { ascending: true })
    .order('created_at', { ascending: false }) as { data: VerificationRow[] | null }

  // Enrich each verification with any Chapter Manager endorsements of
  // that member. Per scope F01 these are an additional trust signal in
  // the queue alongside the screenshot and LinkedIn match.
  const memberIds = (rows ?? []).map(r => r.member_id)
  const { data: endorsements } = memberIds.length
    ? await db
        .from('chapter_endorsements')
        .select(`
          id, member_id, chapter_id, note, created_at,
          endorser:profiles!endorsed_by (full_name),
          eo_chapters!chapter_id (name)
        `)
        .in('member_id', memberIds) as {
          data: Array<{
            id: string
            member_id: string
            chapter_id: number
            note: string | null
            created_at: string
            endorser: { full_name: string | null } | null
            eo_chapters: { name: string } | null
          }> | null
        }
    : { data: [] as Array<{
        id: string
        member_id: string
        chapter_id: number
        note: string | null
        created_at: string
        endorser: { full_name: string | null } | null
        eo_chapters: { name: string } | null
      }> }

  // Index endorsements by member_id for the join.
  const endorseByMember = new Map<string, VerificationRow['cm_endorsements']>()
  for (const e of endorsements ?? []) {
    const list = endorseByMember.get(e.member_id) ?? []
    list.push({
      id: e.id,
      chapter_name: e.eo_chapters?.name ?? null,
      endorser_name: e.endorser?.full_name ?? null,
      note: e.note,
      created_at: e.created_at,
    })
    endorseByMember.set(e.member_id, list)
  }
  const enrichedRows: VerificationRow[] = (rows ?? []).map(r => ({
    ...r,
    cm_endorsements: endorseByMember.get(r.member_id) ?? [],
  }))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Verifications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review member submissions. Approve to assign a verification tag, or request resubmission.
        </p>
      </div>
      <VerificationsQueue rows={enrichedRows} />
    </div>
  )
}
