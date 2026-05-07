'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { format, formatDistanceToNow } from 'date-fns'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type Json = string | number | boolean | null | { [k: string]: Json | undefined } | Json[]

export interface AuditEvent {
  id: string
  type: string
  member_id: string | null
  entity_id: string | null
  metadata: Json
  tenant_id: string
  created_at: string
  profiles: {
    full_name: string | null
    avatar_url: string | null
    eo_chapter: string | null
  } | null
}

type Window = '24h' | '7d' | '30d' | 'all'

// Group event types into UI categories. Add a new key here when a new
// event type is introduced and the timeline filter pills will pick it
// up automatically. Anything not listed lands in 'Other'.
const CATEGORY_PREFIXES: Array<{ key: string; label: string; matches: (t: string) => boolean }> = [
  { key: 'verification', label: 'Verification', matches: t => t.startsWith('verification_') },
  { key: 'member',       label: 'Member',       matches: t => t.startsWith('member_') },
  { key: 'business',     label: 'Business',     matches: t => t.startsWith('business_') },
  { key: 'review',       label: 'Review',       matches: t => t.startsWith('review_') },
  { key: 'category',     label: 'Category',     matches: t => t.startsWith('category_') },
  { key: 'chapter',      label: 'Chapter',      matches: t => t.startsWith('chapter_') },
  { key: 'system',       label: 'System',       matches: t => t === 'slow_replier_batch' },
]

function categoryFor(type: string): string {
  for (const c of CATEGORY_PREFIXES) if (c.matches(type)) return c.key
  return 'other'
}

const TYPE_LABEL: Record<string, string> = {
  verification_approved: 'approved verification',
  verification_rejected: 'rejected verification',
  verification_resubmit_requested: 'requested resubmission',
  verification_linkedin_signal_set: 'set LinkedIn signal',
  member_status_changed: 'changed member status',
  member_role_changed: 'changed member role',
  business_status_changed: 'changed listing status',
  business_deleted: 'deleted listing',
  business_ownership_transferred: 'transferred listing',
  review_unflagged: 'unflagged review',
  review_deleted: 'deleted review',
  category_created: 'created category',
  category_updated: 'updated category',
  category_activated: 'activated category',
  category_deactivated: 'deactivated category',
  chapter_admin_scope_set: 'set chapter scope',
  slow_replier_batch: 'ran slow-replier batch',
}

const CATEGORY_BADGES: Record<string, string> = {
  verification: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  member:       'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
  business:     'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30',
  review:       'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  category:     'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30',
  chapter:      'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/30',
  system:       'bg-muted text-muted-foreground border-border',
  other:        'bg-muted text-muted-foreground border-border',
}

export function AuditLog({ events, initialWindow }: { events: AuditEvent[]; initialWindow: Window }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: events.length }
    for (const e of events) {
      const cat = categoryFor(e.type)
      c[cat] = (c[cat] ?? 0) + 1
    }
    return c
  }, [events])

  const visible = events.filter(e => {
    if (filter !== 'all' && categoryFor(e.type) !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        e.type.toLowerCase().includes(q) ||
        e.profiles?.full_name?.toLowerCase().includes(q) ||
        JSON.stringify(e.metadata).toLowerCase().includes(q)
      )
    }
    return true
  })

  const setWindow = (win: Window) => {
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('window', win)
    router.push(`/admin/audit?${sp.toString()}`)
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              placeholder="Search by event type, admin name, or metadata…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 h-9 px-3 rounded-lg bg-background border border-border text-sm"
            />
            <div className="flex gap-1">
              {(['24h', '7d', '30d', 'all'] as const).map(w => (
                <button
                  key={w}
                  onClick={() => setWindow(w)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium',
                    initialWindow === w ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  {w === '24h' ? '24h' : w === '7d' ? '7 days' : w === '30d' ? '30 days' : 'All time'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            {(['all', 'verification', 'member', 'business', 'review', 'category', 'chapter', 'system', 'other'] as const).map(c => {
              const count = counts[c] ?? 0
              if (c !== 'all' && count === 0) return null
              const label = c === 'all' ? 'All' : (CATEGORY_PREFIXES.find(p => p.key === c)?.label ?? c)
              return (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] font-medium capitalize',
                    filter === c ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  {label} ({count})
                </button>
              )
            })}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {events.length === 0 ? 'No events in this window yet.' : 'No events match your filter.'}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map(event => <EventRow key={event.id} event={event} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false)
  const cat = categoryFor(event.type)
  const label = TYPE_LABEL[event.type] ?? event.type
  const admin = event.profiles
  const summary = formatMetadataSummary(event)
  const hasDetails = event.metadata && Object.keys(event.metadata as object).length > 0

  return (
    <li className="px-4 py-3 hover:bg-muted/20 transition-colors">
      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8 shrink-0 mt-0.5">
          <AvatarImage src={admin?.avatar_url ?? undefined} />
          <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
            {(admin?.full_name ?? '?').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-sm">{admin?.full_name ?? 'Unknown admin'}</span>
            <Badge className={cn('border text-[10px] capitalize', CATEGORY_BADGES[cat])}>
              {cat}
            </Badge>
            <span className="text-sm text-muted-foreground">{label}</span>
            {event.tenant_id && (
              <Badge variant="outline" className="text-[10px] uppercase">{event.tenant_id}</Badge>
            )}
          </div>
          {summary && <p className="text-xs text-muted-foreground mt-0.5">{summary}</p>}
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[11px] text-muted-foreground" title={format(new Date(event.created_at), 'PPpp')}>
              {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
            </p>
            {hasDetails && (
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="inline-flex items-center text-[11px] text-muted-foreground hover:text-foreground"
              >
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {expanded ? 'hide details' : 'details'}
              </button>
            )}
          </div>
          {expanded && hasDetails && (
            <pre className="mt-2 text-[11px] bg-muted/50 border border-border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words font-mono">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * Render a one-line human summary of the metadata, picking the most
 * relevant fields per event type. Falls back to nothing when no
 * meaningful summary can be made — the expandable JSON dump below
 * still surfaces the raw data.
 */
function formatMetadataSummary(event: AuditEvent): string | null {
  const m = event.metadata as Record<string, unknown> | null
  if (!m) return null

  switch (event.type) {
    case 'verification_approved':
      return m.tag ? `assigned ${String(m.tag)}` : null
    case 'verification_rejected':
    case 'verification_resubmit_requested':
      return m.reason || m.note ? `“${String(m.reason ?? m.note).slice(0, 100)}”` : null
    case 'verification_linkedin_signal_set':
      return m.signal ? `→ ${String(m.signal)}` : null
    case 'member_status_changed':
      return m.status ? `→ ${String(m.status)}` : null
    case 'member_role_changed':
      return m.role ? `→ ${String(m.role)}` : null
    case 'business_status_changed':
      return m.status ? `→ ${String(m.status)}` : null
    case 'business_deleted':
      return m.name ? `“${String(m.name)}”` : null
    case 'business_ownership_transferred':
      return m.name ? `“${String(m.name)}” to a new owner` : 'to a new owner'
    case 'category_created':
    case 'category_updated':
      return m.name ? String(m.name) : null
    case 'chapter_admin_scope_set':
      return [m.country, m.city].filter(Boolean).join(' / ') || 'cleared'
    default:
      return null
  }
}
