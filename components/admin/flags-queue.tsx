'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  dismissFlagsForTarget,
  disposeFlagsAgainstMember,
} from '@/actions/flags'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { format, formatDistanceToNow } from 'date-fns'
import { AlertTriangle, ShieldOff, Ban, CheckCircle2, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MessageThreadDialog } from '@/components/admin/message-thread-dialog'

type TargetType = 'listing' | 'post' | 'response' | 'review' | 'message'
type FlagType = 'solicitation' | 'spam' | 'inaccurate' | 'inappropriate'
type Status = 'open' | 'dismissed' | 'warned' | 'suspended' | 'banned'
type Disposition = 'warned' | 'suspended' | 'banned'

export interface FlagRow {
  id: string
  target_type: TargetType
  target_id: string
  type: FlagType
  reason: string | null
  status: Status
  created_at: string
  reporter: { full_name: string | null; avatar_url: string | null } | null
}

export interface FlagGroup {
  target_type: TargetType
  target_id: string
  target_name: string | null
  flags: FlagRow[]
  open_count: number
  latest_at: string
}

const TYPE_VARIANTS: Record<FlagType, string> = {
  solicitation: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
  spam:         'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30',
  inaccurate:   'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  inappropriate:'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30',
}

const TARGET_LABELS: Record<TargetType, string> = {
  listing: 'Listing',
  post: 'Bulletin post',
  response: 'Response',
  review: 'Review',
  message: 'Message',
}

export function FlagsQueue({ groups }: { groups: FlagGroup[] }) {
  const [filter, setFilter] = useState<'open' | 'escalated' | 'resolved' | 'all'>('open')
  const [search, setSearch] = useState('')

  const counts = useMemo(() => ({
    open: groups.filter(g => g.open_count > 0).length,
    escalated: groups.filter(g => g.open_count >= 3).length,
    resolved: groups.filter(g => g.open_count === 0).length,
    all: groups.length,
  }), [groups])

  const visible = groups.filter(g => {
    if (filter === 'open' && g.open_count === 0) return false
    if (filter === 'escalated' && g.open_count < 3) return false
    if (filter === 'resolved' && g.open_count > 0) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        g.target_name?.toLowerCase().includes(q) ||
        g.target_type.toLowerCase().includes(q) ||
        g.flags.some(f => f.reason?.toLowerCase().includes(q) || f.reporter?.full_name?.toLowerCase().includes(q))
      )
    }
    return true
  })

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
        <input
          placeholder="Search by target, reporter, or reason…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 h-9 px-3 rounded-lg bg-background border border-border text-sm"
        />
        <div className="flex gap-1 flex-wrap">
          {([
            ['open', 'Open'],
            ['escalated', '3+ flags'],
            ['resolved', 'Resolved'],
            ['all', 'All'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium',
                filter === k ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              )}
            >
              {label} ({counts[k]})
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No flags in this view.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map(g => <FlagGroupItem key={`${g.target_type}:${g.target_id}`} group={g} />)}
        </ul>
      )}
    </div>
  )
}

function FlagGroupItem({ group }: { group: FlagGroup }) {
  const [expanded, setExpanded] = useState(false)
  const [disposeOpen, setDisposeOpen] = useState<Disposition | null>(null)
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const escalated = group.open_count >= 3
  const allResolved = group.open_count === 0

  const dismiss = () => {
    startTransition(async () => {
      const res = await dismissFlagsForTarget(group.target_type, group.target_id)
      if (!res.error) router.refresh()
    })
  }

  const targetHref = group.target_type === 'listing' ? `/marketplace/${group.target_id}` : null
  const isMessageFlag = group.target_type === 'message'

  return (
    <li className={cn('p-4 transition-colors', escalated ? 'bg-red-500/5' : 'hover:bg-muted/20')}>
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]">{TARGET_LABELS[group.target_type]}</Badge>
            {escalated && (
              <Badge className="border bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30 text-[10px] gap-1">
                <AlertTriangle className="h-3 w-3" /> Escalated · {group.open_count} open
              </Badge>
            )}
            {!escalated && group.open_count > 0 && (
              <Badge className="border bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20 text-[10px]">
                {group.open_count} open
              </Badge>
            )}
            {allResolved && (
              <Badge className="border bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 text-[10px] gap-1">
                <CheckCircle2 className="h-3 w-3" /> Resolved
              </Badge>
            )}
          </div>
          <h3 className="font-semibold mt-1">{group.target_name ?? `(target ${group.target_id.slice(0, 8)})`}</h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {Array.from(new Set(group.flags.filter(f => f.status === 'open').map(f => f.type))).map(t => (
              <Badge key={t} className={cn('border capitalize text-[10px]', TYPE_VARIANTS[t])}>{t}</Badge>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1" title={format(new Date(group.latest_at), 'PPpp')}>
            Latest flag {formatDistanceToNow(new Date(group.latest_at), { addSuffix: true })}
            {' · '}{group.flags.length} total report{group.flags.length === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronDown className="h-3 w-3 mr-0.5" /> : <ChevronRight className="h-3 w-3 mr-0.5" />}
              {expanded ? 'Hide reports' : 'View all reports'}
            </button>
            {targetHref && (
              <Link
                href={targetHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open target <ExternalLink className="h-3 w-3" />
              </Link>
            )}
            {isMessageFlag && (
              <MessageThreadDialog
                messageId={group.target_id}
                targetName={group.target_name}
              />
            )}
          </div>
          {expanded && (
            <ul className="mt-3 space-y-2">
              {group.flags.map(f => <FlagDetail key={f.id} flag={f} />)}
            </ul>
          )}
        </div>

        {!allResolved && (
          <div className="flex flex-wrap gap-2 lg:flex-col lg:w-44 shrink-0">
            <Button size="sm" variant="outline" onClick={dismiss} disabled={isPending} className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Dismiss
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDisposeOpen('warned')} disabled={isPending} className="gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Warn member
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDisposeOpen('suspended')} disabled={isPending} className="text-destructive hover:text-destructive gap-1.5">
              <ShieldOff className="h-3.5 w-3.5" /> Suspend
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDisposeOpen('banned')} disabled={isPending} className="text-destructive hover:text-destructive gap-1.5">
              <Ban className="h-3.5 w-3.5" /> Ban
            </Button>
          </div>
        )}
      </div>

      {disposeOpen && (
        <DisposeDialog
          group={group}
          disposition={disposeOpen}
          onClose={() => setDisposeOpen(null)}
        />
      )}
    </li>
  )
}

function FlagDetail({ flag }: { flag: FlagRow }) {
  return (
    <li className="flex gap-2 p-2 rounded-md bg-muted/30">
      <Avatar className="h-6 w-6 shrink-0 mt-0.5">
        <AvatarImage src={flag.reporter?.avatar_url ?? undefined} />
        <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-bold">
          {(flag.reporter?.full_name ?? '?').charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-medium">{flag.reporter?.full_name ?? 'Unknown'}</span>
          <Badge className={cn('border capitalize text-[10px]', TYPE_VARIANTS[flag.type])}>{flag.type}</Badge>
          {flag.status !== 'open' && (
            <Badge variant="secondary" className="text-[10px] capitalize">{flag.status}</Badge>
          )}
          <span className="text-[11px] text-muted-foreground" title={format(new Date(flag.created_at), 'PPpp')}>
            {formatDistanceToNow(new Date(flag.created_at), { addSuffix: true })}
          </span>
        </div>
        {flag.reason && <p className="text-xs text-muted-foreground mt-0.5">“{flag.reason}”</p>}
      </div>
    </li>
  )
}

function DisposeDialog({
  group, disposition, onClose,
}: { group: FlagGroup; disposition: Disposition; onClose: () => void }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const titles: Record<Disposition, string> = {
    warned: 'Warn the member',
    suspended: 'Suspend the member',
    banned: 'Ban the member',
  }
  const descriptions: Record<Disposition, string> = {
    warned: 'Resolves the open flag(s) and records a warning. Use for first-time minor offences.',
    suspended: 'Sets the offending member to suspended — they cannot log in until reactivated. Use for repeat offences or solicitation.',
    banned: 'Bans the offending member. Stronger than suspension; future restoration requires explicit super-admin action.',
  }

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const res = await disposeFlagsAgainstMember(group.target_type, group.target_id, disposition, note || undefined)
      if (res.error) { setError(res.error); return }
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titles[disposition]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">{descriptions[disposition]}</p>
          <p className="text-xs text-muted-foreground">
            Target: <span className="text-foreground font-medium">{group.target_name ?? group.target_id}</span>
          </p>
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (optional) — recorded with the disposition for the audit trail."
            rows={3}
            maxLength={500}
            className="resize-none"
          />
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={isPending}
            className={
              disposition === 'warned'
                ? undefined
                : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            }
          >
            {isPending ? 'Working…' : disposition === 'warned' ? 'Warn' : disposition === 'suspended' ? 'Suspend' : 'Ban'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
