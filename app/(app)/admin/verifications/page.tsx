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
      profiles!member_id (
        full_name, avatar_url, eo_chapter, eo_membership_email,
        verification_tag, tenant_id
      )
    `)
    .order('status', { ascending: true })
    .order('created_at', { ascending: false }) as { data: VerificationRow[] | null }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Verifications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review member submissions. Approve to assign a verification tag, or request resubmission.
        </p>
      </div>
      <VerificationsQueue rows={rows ?? []} />
    </div>
  )
}
