'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface InvitedListing {
  id: string
  name: string
  email: string | null
  created_at: string
  claim_email_sent_at: string | null
}

const PAGE_SIZE_OPTIONS = [20, 50] as const
type PageSize = typeof PAGE_SIZE_OPTIONS[number]

export function InvitedListingsTable({ listings }: { listings: InvitedListing[] }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(20)

  const totalPages = Math.ceil(listings.length / pageSize)
  const paginated = listings.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted border-b border-border">
          <tr>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Business</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Email invited</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Invited</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Claim email sent</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {paginated.map(l => (
            <tr key={l.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2.5 font-medium">{l.name}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{l.email ?? '—'}</td>
              <td className="px-4 py-2.5 text-muted-foreground text-xs">
                {new Date(l.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-2.5 text-xs">
                {l.claim_email_sent_at
                  ? <span className="text-green-600 dark:text-green-400">✓ {new Date(l.claim_email_sent_at).toLocaleDateString()}</span>
                  : <span className="text-yellow-600">Pending</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {listings.length > 0 && (
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
          <span className="text-xs">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, listings.length)} of {listings.length}</span>
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
