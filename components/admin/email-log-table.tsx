'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, XCircle, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type EmailStatus = 'sent' | 'failed' | 'skipped'

interface EmailLogRow {
  id: string
  created_at: string
  metadata: {
    to: string
    subject: string
    status: EmailStatus
    error: string | null
  }
}

const STATUS_CONFIG = {
  sent:    { icon: CheckCircle2, color: 'text-green-600 dark:text-green-400', badge: 'bg-green-500/10 text-green-700 border-green-500/20' },
  failed:  { icon: XCircle,      color: 'text-destructive',                   badge: 'bg-red-500/10 text-red-700 border-red-500/20' },
  skipped: { icon: AlertCircle,  color: 'text-yellow-600',                    badge: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20' },
}

const PAGE_SIZE_OPTIONS = [20, 50] as const
type PageSize = typeof PAGE_SIZE_OPTIONS[number]

export function EmailLogTable({ emails }: { emails: EmailLogRow[] }) {
  const [statusFilter, setStatusFilter] = useState<'all' | EmailStatus>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(20)

  const filtered = emails.filter(e => {
    const m = e.metadata ?? {}
    if (statusFilter !== 'all' && m.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return m.to?.toLowerCase().includes(q) || m.subject?.toLowerCase().includes(q)
    }
    return true
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize)

  const handleFilter = (s: typeof statusFilter) => { setStatusFilter(s); setPage(0) }
  const handleSearch = (q: string) => { setSearch(q); setPage(0) }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
        <input
          placeholder="Search by email or subject…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="flex-1 h-9 px-3 rounded-lg bg-background border border-border text-sm"
        />
        <div className="flex gap-1">
          {(['all', 'sent', 'failed', 'skipped'] as const).map(s => (
            <button key={s} onClick={() => handleFilter(s)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium capitalize',
                statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}>
              {s === 'all' ? `all (${emails.length})` : `${s} (${emails.filter(e => e.metadata?.status === s).length})`}
            </button>
          ))}
        </div>
      </div>
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
          {paginated.map(e => {
            const m = e.metadata ?? {}
            const status = (m.status ?? 'sent') as EmailStatus
            const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.sent
            const Icon = cfg.icon
            return (
              <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5">
                  <Badge className={`border text-[10px] gap-1 ${cfg.badge}`}>
                    <Icon className="h-3 w-3" />{status}
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
          {paginated.length === 0 && (
            <tr><td colSpan={4} className="text-center py-10 text-muted-foreground text-sm">No emails match your filter.</td></tr>
          )}
        </tbody>
      </table>
      {filtered.length > 0 && (
        <div className="p-3 border-t border-border flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Show</span>
            {PAGE_SIZE_OPTIONS.map(n => (
              <button key={n} onClick={() => { setPageSize(n); setPage(0) }}
                className={cn('px-2 py-0.5 rounded text-xs font-medium', pageSize === n ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}>
                {n}
              </button>
            ))}
          </div>
          <span className="text-xs">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="p-1 rounded hover:bg-muted disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-muted disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
