import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { EmailLogTable } from '@/components/admin/email-log-table'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

const SERVER_PAGE_SIZE = 1000

type EmailLogRow = {
  id: string
  created_at: string
  metadata: {
    to: string
    subject: string
    status: 'sent' | 'failed' | 'skipped'
    error: string | null
  }
}

interface PageProps {
  searchParams: Promise<{ page?: string }>
}

export default async function AdminEmailLogPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await db
    .from('profiles').select('role').eq('id', user.id).single() as { data: { role: string } | null }
  if (!me || !['chapter_admin', 'super_admin'].includes(me.role)) redirect('/admin')

  const serverPage = Math.max(0, parseInt(params.page ?? '0', 10) || 0)
  const offset = serverPage * SERVER_PAGE_SIZE

  const { count: totalCount } = await db
    .from('events_log')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'email_sent') as { count: number | null }

  const { data: rows } = await db
    .from('events_log')
    .select('id, created_at, metadata')
    .eq('type', 'email_sent')
    .order('created_at', { ascending: false })
    .range(offset, offset + SERVER_PAGE_SIZE - 1) as { data: EmailLogRow[] | null }

  const emails = rows ?? []
  const hasMore = emails.length === SERVER_PAGE_SIZE
  const sentCount   = emails.filter(e => e.metadata?.status === 'sent').length
  const failedCount = emails.filter(e => e.metadata?.status === 'failed').length

  const buildUrl = (p: number) => `/admin/email-log${p > 0 ? `?page=${p}` : ''}`

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Email log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every email the platform has attempted to send.
          {serverPage > 0 ? ` · Page ${serverPage + 1}` : ''}
        </p>
      </div>

      <div className="flex gap-4 flex-wrap text-sm">
        <span className="text-muted-foreground">Showing: <strong className="text-foreground">{offset + 1}–{offset + emails.length}</strong> of <strong className="text-foreground">{totalCount ?? '…'}</strong></span>
        <span className="text-green-600">Sent: <strong>{sentCount}</strong></span>
        {failedCount > 0 && <span className="text-destructive">Failed: <strong>{failedCount}</strong></span>}
      </div>

      {emails.length === 0 ? (
        <div className="bg-card border border-border rounded-xl text-center py-16 text-sm text-muted-foreground">
          No emails logged yet.
        </div>
      ) : (
        <EmailLogTable emails={emails} />
      )}

      {(serverPage > 0 || hasMore) && (
        <div className="flex items-center justify-between pt-2">
          {serverPage > 0 ? (
            <Link href={buildUrl(serverPage - 1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" /> Newer
            </Link>
          ) : <span />}
          {hasMore && (
            <Link href={buildUrl(serverPage + 1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              Older <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
