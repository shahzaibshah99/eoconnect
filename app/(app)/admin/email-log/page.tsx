import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EmailLogTable } from '@/components/admin/email-log-table'

export const dynamic = 'force-dynamic'

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

export default async function AdminEmailLogPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await db
    .from('profiles').select('role').eq('id', user.id).single() as { data: { role: string } | null }
  if (!me || !['chapter_admin', 'super_admin'].includes(me.role)) redirect('/admin')

  const { data: rows } = await db
    .from('events_log')
    .select('id, created_at, metadata')
    .eq('type', 'email_sent')
    .order('created_at', { ascending: false })
    .limit(5000) as { data: EmailLogRow[] | null }

  const emails = rows ?? []
  const sentCount   = emails.filter(e => e.metadata?.status === 'sent').length
  const failedCount = emails.filter(e => e.metadata?.status === 'failed').length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Email log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every email the platform has attempted to send.
        </p>
      </div>

      <div className="flex gap-4 flex-wrap text-sm">
        <span className="text-muted-foreground">Total: <strong className="text-foreground">{emails.length}</strong></span>
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
    </div>
  )
}
