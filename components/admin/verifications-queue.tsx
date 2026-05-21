'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  approveVerification,
  rejectVerification,
  requestVerificationResubmission,
  setVerificationLinkedInSignal,
  rescrapeLinkedInSignal,
} from '@/actions/admin'
import {
  assignableTagsForTenant,
  VERIFICATION_TAG_LABEL,
  type AssignableTag,
  type VerificationTag,
} from '@/lib/verification-tags'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { format, formatDistanceToNow } from 'date-fns'
import { Briefcase, ImageIcon, ExternalLink, Check, X, RotateCcw, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type Status = 'pending' | 'approved' | 'rejected' | 'resubmit'
type Method = 'screenshot' | 'linkedin' | 'chapter_manager' | 'peer'
type LinkedInSignal = 'yes' | 'no' | 'unclear' | null

export interface VerificationRow {
  id: string
  member_id: string
  tenant_id: string
  method: Method | null
  screenshot_url: string | null
  linkedin_url: string | null
  linkedin_signal: LinkedInSignal
  status: Status
  rejection_reason: string | null
  reviewed_at: string | null
  created_at: string
  claimed_tag: AssignableTag | null
  profiles: {
    full_name: string | null
    avatar_url: string | null
    eo_chapter: string | null
    eo_membership_email: string | null
    verification_tag: VerificationTag
    tenant_id: string
  } | null
  /** Chapter Manager endorsements of this member — supporting trust
   *  signal beyond the screenshot + LinkedIn check. Per scope F01. */
  cm_endorsements?: Array<{
    id: string
    chapter_name: string | null
    endorser_name: string | null
    note: string | null
    created_at: string
  }>
}

const STATUS_VARIANTS: Record<Status, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  rejected: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  resubmit: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
}

const SIGNAL_VARIANTS: Record<NonNullable<LinkedInSignal>, string> = {
  yes: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
  no: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
  unclear: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
}

const SIGNAL_LABEL: Record<NonNullable<LinkedInSignal>, string> = {
  yes: 'Match',
  no: 'No match',
  unclear: 'Unclear',
}

const METHOD_LABEL: Record<Method, string> = {
  screenshot: 'Screenshot',
  linkedin: 'LinkedIn',
  chapter_manager: 'Chapter Mgr',
  peer: 'Peer',
}

export function VerificationsQueue({ rows }: { rows: VerificationRow[] }) {
  const [filter, setFilter] = useState<'all' | Status>('pending')
  const [search, setSearch] = useState('')

  const counts = useMemo(() => {
    const c: Record<Status, number> = { pending: 0, approved: 0, rejected: 0, resubmit: 0 }
    for (const r of rows) c[r.status]++
    return c
  }, [rows])

  const filtered = rows.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      const p = r.profiles
      return (
        p?.full_name?.toLowerCase().includes(q) ||
        p?.eo_membership_email?.toLowerCase().includes(q) ||
        p?.eo_chapter?.toLowerCase().includes(q)
      ) ?? false
    }
    return true
  })

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
        <input
          placeholder="Search by name, email, chapter…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 h-9 px-3 rounded-lg bg-background border border-border text-sm"
        />
        <div className="flex gap-1 flex-wrap">
          {(['pending', 'resubmit', 'approved', 'rejected', 'all'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium capitalize',
                filter === s ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              )}
            >
              {s} {s !== 'all' && `(${counts[s as Status]})`}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No verifications match this filter.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map(row => <VerificationItem key={row.id} row={row} />)}
        </ul>
      )}
    </div>
  )
}

function VerificationItem({ row }: { row: VerificationRow }) {
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [resubmitOpen, setResubmitOpen] = useState(false)
  const p = row.profiles

  const isPending = row.status === 'pending' || row.status === 'resubmit'

  return (
    <li className="p-4 hover:bg-muted/20 transition-colors">
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        {/* Left: identity */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={p?.avatar_url ?? undefined} />
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
              {(p?.full_name ?? '?').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{p?.full_name ?? '—'}</p>
              <Badge className={cn('border capitalize text-[10px]', STATUS_VARIANTS[row.status])}>
                {row.status}
              </Badge>
              {row.claimed_tag && (
                <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">
                  Claims: {VERIFICATION_TAG_LABEL[row.claimed_tag]}
                </Badge>
              )}
              {p?.verification_tag && p.verification_tag !== 'unverified' && (
                <Badge variant="secondary" className="text-[10px]">
                  Current: {VERIFICATION_TAG_LABEL[p.verification_tag]}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] uppercase">
                {row.tenant_id}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {[p?.eo_membership_email, p?.eo_chapter].filter(Boolean).join(' · ') || '—'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1" title={format(new Date(row.created_at), 'PPpp')}>
              Submitted {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
              {row.method && ` · via ${METHOD_LABEL[row.method]}`}
            </p>
            {row.rejection_reason && (
              <p className="text-xs mt-2 p-2 rounded-md bg-muted/40 border border-border">
                <span className="font-medium">Last note:</span> {row.rejection_reason}
              </p>
            )}
            {row.cm_endorsements && row.cm_endorsements.length > 0 && (
              <div className="mt-2 space-y-1">
                {row.cm_endorsements.map(e => (
                  <div
                    key={e.id}
                    className="text-xs p-2 rounded-md bg-green-500/5 border border-green-500/20"
                  >
                    <p className="font-medium text-green-700 dark:text-green-400">
                      ✓ Endorsed as in-chapter by {e.endorser_name ?? 'a Chapter Manager'}
                      {e.chapter_name && ` of ${e.chapter_name}`}
                    </p>
                    {e.note && <p className="text-muted-foreground mt-0.5 italic">&ldquo;{e.note}&rdquo;</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Middle: signals */}
        <div className="flex flex-col gap-2 lg:w-64 shrink-0">
          <LinkedInSignalRow row={row} />
          {row.screenshot_url && (
            <a
              href={row.screenshot_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-primary hover:underline"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              View screenshot
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {row.linkedin_url && (
            <a
              href={row.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-primary hover:underline"
            >
              <Briefcase className="h-3.5 w-3.5" />
              Open LinkedIn
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex flex-wrap gap-2 lg:flex-col lg:w-40 shrink-0">
          <Link
            href={`/admin/members?q=${encodeURIComponent(p?.eo_membership_email ?? '')}`}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline self-start lg:self-end"
          >
            View member →
          </Link>
          {isPending && (
            <>
              <Button size="sm" onClick={() => setApproveOpen(true)} className="gap-1.5">
                <Check className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setResubmitOpen(true)}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Resubmit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRejectOpen(true)}
                className="text-destructive hover:text-destructive gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                Reject
              </Button>
            </>
          )}
        </div>
      </div>

      <ApproveDialog row={row} open={approveOpen} onOpenChange={setApproveOpen} />
      <ReasonDialog
        row={row}
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject verification"
        description="Tell the member why their submission can't be approved. They'll see this when they next try to verify."
        confirmLabel="Reject"
        destructive
        onSubmit={async (reason) => {
          const res = await rejectVerification(row.id, reason)
          if (res.error) throw new Error(res.error)
        }}
      />
      <ReasonDialog
        row={row}
        open={resubmitOpen}
        onOpenChange={setResubmitOpen}
        title="Request resubmission"
        description="Tell the member what to fix or add. Their submission status becomes 'resubmit' and they can re-submit with the new info."
        confirmLabel="Send request"
        onSubmit={async (note) => {
          const res = await requestVerificationResubmission(row.id, note)
          if (res.error) throw new Error(res.error)
        }}
      />
    </li>
  )
}

function LinkedInSignalRow({ row }: { row: VerificationRow }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isRescraping, startRescrape] = useTransition()
  const signal = row.linkedin_signal

  const setSignal = (s: NonNullable<LinkedInSignal>) => {
    startTransition(async () => {
      await setVerificationLinkedInSignal(row.id, s)
      router.refresh()
    })
  }

  const rescrape = () => {
    startRescrape(async () => {
      await rescrapeLinkedInSignal(row.id)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="text-muted-foreground">LinkedIn:</span>
      {signal ? (
        <Badge className={cn('border capitalize', SIGNAL_VARIANTS[signal])}>
          {SIGNAL_LABEL[signal]}
        </Badge>
      ) : (
        <span className="text-muted-foreground italic">not checked</span>
      )}
      {/* Auto-scrape re-trigger — useful when the submit-time scrape failed
          (RapidAPI down, key missing) or after the member updates LinkedIn. */}
      {row.linkedin_url && (
        <button
          type="button"
          onClick={rescrape}
          disabled={isRescraping}
          className={cn(
            'h-5 px-1.5 rounded text-[10px] border border-border inline-flex items-center gap-1 hover:bg-muted',
            isRescraping && 'opacity-50 cursor-not-allowed'
          )}
          title="Re-run LinkedIn auto-scrape"
        >
          <RefreshCw className={cn('h-2.5 w-2.5', isRescraping && 'animate-spin')} />
          {isRescraping ? 'scraping…' : 'rescan'}
        </button>
      )}
      {/* Manual override — admin can set/correct after eyeballing the URL. */}
      <div className="flex gap-0.5">
        {(['yes', 'no', 'unclear'] as const).map(s => (
          <button
            key={s}
            type="button"
            disabled={isPending || signal === s}
            onClick={() => setSignal(s)}
            className={cn(
              'h-5 w-5 rounded text-[10px] border',
              signal === s
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border hover:bg-muted',
              isPending && 'opacity-50 cursor-not-allowed'
            )}
            title={`Set to ${SIGNAL_LABEL[s]}`}
          >
            {s === 'yes' ? '✓' : s === 'no' ? '✗' : '?'}
          </button>
        ))}
      </div>
    </div>
  )
}

function ApproveDialog({
  row, open, onOpenChange,
}: { row: VerificationRow; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Both rows carry tenant_id (NOT NULL in DB). Prefer the joined
  // profile's value — that's the canonical source for tag vocabulary.
  const tenant = row.profiles?.tenant_id ?? row.tenant_id
  const tags = assignableTagsForTenant(tenant)
  // Pre-select the tag the member claimed; fall back to first in list.
  const defaultTag = row.claimed_tag && tags.includes(row.claimed_tag) ? row.claimed_tag : tags[0]
  const [tag, setTag] = useState<AssignableTag>(defaultTag)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const res = await approveVerification(row.id, tag)
      if (res.error) {
        setError(res.error)
        return
      }
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Approve verification</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Assign a verification tag to <strong>{row.profiles?.full_name ?? 'this member'}</strong>.
            The tag will propagate to their listings and drive search ranking.
          </p>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Verification tag
            </label>
            <Select value={tag} onValueChange={(v: string | null) => v && setTag(v as AssignableTag)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {tags.map(t => (
                  <SelectItem key={t} value={t}>{VERIFICATION_TAG_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? 'Approving…' : 'Approve & assign tag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReasonDialog({
  row, open, onOpenChange, title, description, confirmLabel, destructive, onSubmit,
}: {
  row: VerificationRow
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onSubmit: (reason: string) => Promise<void>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    startTransition(async () => {
      try {
        await onSubmit(reason)
        setReason('')
        onOpenChange(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isPending) { onOpenChange(v); if (!v) { setError(null); setReason('') } } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="text-xs text-muted-foreground">
            For: <strong className="text-foreground">{row.profiles?.full_name ?? 'this member'}</strong>
          </p>
          <Textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. The screenshot is cut off — please re-upload showing your full member profile page."
            rows={4}
            maxLength={500}
            className="resize-none"
          />
          <p className="text-[11px] text-muted-foreground text-right">{reason.length}/500</p>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={isPending || reason.trim().length < 3}
            className={destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
          >
            {isPending ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
