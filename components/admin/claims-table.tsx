'use client'

import { useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Clock, Mail, User, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ClaimRow {
  id: string
  name: string
  email: string | null
  created_at: string
  claim_email_sent_at: string | null
  claimed_at: string | null
  profiles?: {
    full_name: string | null
    eo_membership_email: string | null
    eo_chapter: string | null
    verification_tag: string | null
  } | null
}

const PAGE_SIZE_OPTIONS = [20, 50] as const
type PageSize = typeof PAGE_SIZE_OPTIONS[number]

type FilterTab = 'all' | 'claimed' | 'pending' | 'no_invite'

export function ClaimsTable({ listings }: { listings: ClaimRow[] }) {
  const [tab, setTab] = useState<FilterTab>('all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(20)

  const claimed   = listings.filter(l => l.claimed_at)
  const pending   = listings.filter(l => !l.claimed_at && l.claim_email_sent_at)
  const noInvite  = listings.filter(l => !l.claim_email_sent_at)

  const filtered = tab === 'claimed' ? claimed : tab === 'pending' ? pending : tab === 'no_invite' ? noInvite : listings

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize)

  const handleTab = (t: FilterTab) => { setTab(t); setPage(0) }

  return (
    <div>
      {/* Tab filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          ['all', `All (${listings.length})`],
          ['claimed', `Claimed (${claimed.length})`],
          ['pending', `Pending (${pending.length})`],
          ['no_invite', `No invite (${noInvite.length})`],
        ] as const).map(([t, label]) => (
          <button key={t} onClick={() => handleTab(t)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium', tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Business</th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Invited email</th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Invite sent</th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Claimed by</th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Claimed at</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginated.map(l => {
              const isClaimed = !!l.claimed_at
              const hasEmail  = !!l.claim_email_sent_at
              return (
                <tr key={l.id} className={`hover:bg-muted/30 transition-colors ${isClaimed ? 'bg-green-500/5' : ''}`}>
                  <td className="px-4 py-3 font-medium">{l.name}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs font-mono truncate max-w-[180px]" title={l.email ?? ''}>
                    {l.email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {hasEmail ? (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <Mail className="h-3 w-3" />
                        {format(new Date(l.claim_email_sent_at!), 'MMM d, HH:mm')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">Not sent</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isClaimed ? (
                      <Badge className="border bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 text-[10px] gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Claimed
                      </Badge>
                    ) : hasEmail ? (
                      <Badge className="border bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20 text-[10px] gap-1">
                        <Clock className="h-3 w-3" /> Pending
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">No invite</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {l.profiles ? (
                      <div className="flex items-start gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="font-medium text-xs truncate">{l.profiles.full_name ?? '—'}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{l.profiles.eo_membership_email ?? ''}</p>
                          {l.profiles.eo_chapter && (
                            <p className="text-[10px] text-muted-foreground">{l.profiles.eo_chapter}</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/50 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {l.claimed_at ? (
                      <span title={format(new Date(l.claimed_at), 'PPpp')}>
                        {formatDistanceToNow(new Date(l.claimed_at), { addSuffix: true })}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-muted-foreground text-sm">No listings in this filter.</td>
              </tr>
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
    </div>
  )
}
