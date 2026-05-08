import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { CmImportsView, type CmImportRow } from '@/components/chapter-manager/cm-imports-view'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * CM-side CSV import page. Two parts:
 *   - Submit a new import (lands in /admin/imports queue)
 *   - History of submissions for this chapter, with admin's review status
 *
 * History scopes by chapter_id AND submitted_by — the CM only sees
 * imports they themselves submitted, not ones from other CMs of the
 * same chapter (privacy + audit clarity).
 */
export default async function CmImportsPage({ params }: PageProps) {
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

  const { data: history } = await db
    .from('csv_imports')
    .select('id, source, row_count, status, rejection_reason, reviewed_at, processed_at, created_at')
    .eq('chapter_id', chapterId)
    .eq('submitted_by', user.id)
    .order('created_at', { ascending: false })
    .limit(50) as { data: CmImportRow[] | null }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{chapter.name} · CSV Imports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Submit a member roster for this chapter. App Admin reviews before any data goes live.
        </p>
      </div>
      <CmImportsView chapterId={chapterId} history={history ?? []} />
    </div>
  )
}
