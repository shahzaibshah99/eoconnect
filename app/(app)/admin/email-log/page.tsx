import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

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

const STATUS_CONFIG = {
  sent:    { icon: CheckCircle2, color: 'text-green-600 dark:text-green-400', badge: 'bg-green-500/10 text-green-700 border-green-500/20' },
  failed:  { icon: XCircle,      color: 'text-destructive',                    badge: 'bg-red-500/10 text-red-700 border-red-500/20' },
  skipped: { icon: AlertCircle,  color: 'text-yellow-600',                     badge: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20' },
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
    .limit(500) as { data: EmailLogRow[] | null }

  const emails = rows ?? []
  const sentCount   = emails.filter(e => e.metadata?.status === 'sent').length
  const failedCount = emails.filter(e => e.metadata?.status === 'failed').length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Email log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every email the platform has attempted to send — last 500.
        </p>
      </div>

      {/* Summary stats */}
      <div className="flex gap-4 flex-wrap text-sm">
        <span className="text-muted-foreground">Total: <strong className="text-foreground">{emails.length}</strong></span>
        <span className="text-green-600">Sent: <strong>{sentCount}</strong></span>
        {failedCount > 0 && <span className="text-destructive">Failed: <strong>{failedCount}</strong></span>}
      </div>

      {emails.length === 0 ? (
        <div className="bg-card border border-border rounded-xl text-center py-16 text-sm text-muted-foreground">
          No emails logged yet. Emails will appear here as soon as the system sends one.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">To</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Subject</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {emails.map(e => {
                const m = e.metadata ?? {}
                const status = (m.status ?? 'sent') as 'sent' | 'failed' | 'skipped'
                const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.sent
                const Icon = cfg.icon
                return (
                  <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <Badge className={`border text-[10px] gap-1 ${cfg.badge}`}>
                        <Icon className="h-3 w-3" />
                        {status}
                      </Badge>
                      {m.error && (
                        <p className="text-[11px] text-destructive mt-0.5 font-mono truncate max-w-[180px]" title={m.error}>
                          {m.error}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs truncate max-w-[220px]" title={m.to}>
                      {m.to}
                    </td>
                    <td className="px-4 py-2.5 truncate max-w-[260px]" title={m.subject}>
                      {m.subject}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                      {format(new Date(e.created_at), 'MMM d, HH:mm')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
