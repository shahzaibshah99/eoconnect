import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ImportsList, type ImportRow } from '@/components/admin/imports-list'

export const dynamic = 'force-dynamic'

/**
 * CSV import queue. Open to chapter_admin + super_admin (both moderate).
 * Source split lives in each row: 'admin' = direct upload, 'chapter_manager'
 * = CM submission awaiting review.
 *
 * Per scope F15: app admin reviews and approves CM CSV imports before
 * they go live. The CM panel itself doesn't exist yet — this queue is
 * the receiving end, ready for when it does.
 */
export default async function AdminImportsPage() {
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

  const { data: imports } = await db
    .from('csv_imports')
    .select(`
      id, source, row_count, status, rejection_reason, chapter_id,
      reviewed_at, processed_at, created_at, payload,
      submitted:profiles!submitted_by ( full_name, avatar_url, eo_membership_email ),
      reviewer:profiles!reviewed_by ( full_name ),
      eo_chapters!chapter_id ( name )
    `)
    .order('created_at', { ascending: false })
    .limit(200) as { data: ImportRow[] | null }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">CSV imports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload member rosters or review pending submissions from chapter managers.
        </p>
      </div>
      <ImportsList rows={imports ?? []} canUpload={me.role === 'super_admin'} />
    </div>
  )
}
