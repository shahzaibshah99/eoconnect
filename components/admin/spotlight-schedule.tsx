'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  scheduleSpotlight,
  approveSpotlight,
  rejectSpotlight,
  cancelSpotlight,
  searchBusinessesForSpotlight,
  type SpotlightBusinessResult,
} from '@/actions/spotlight'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { format, parseISO } from 'date-fns'
import { Plus, Search, Check, X, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled'
type SpotlightType = 'paid' | 'rotated'

export interface SpotlightRow {
  id: string
  business_id: string
  month: string
  type: SpotlightType | null
  status: Status
  rejection_reason: string | null
  created_at: string
  businesses: { name: string; city: string | null; country: string | null; logo_url: string | null } | null
  nominator: { full_name: string | null } | null
  approver: { full_name: string | null } | null
}

const STATUS_VARIANTS: Record<Status, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  rejected: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  cancelled: 'bg-muted text-muted-foreground border-border',
}

const TYPE_VARIANTS: Record<SpotlightType, string> = {
  paid: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  rotated: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
}

export function SpotlightSchedule({ rows }: { rows: SpotlightRow[] }) {
  const [filter, setFilter] = useState<'upcoming' | 'pending' | 'all'>('upcoming')
  const [scheduleOpen, setScheduleOpen] = useState(false)

  // Bucket rows by month for the grouped list.
  const today = new Date().toISOString().slice(0, 10)

  const counts = useMemo(() => ({
    upcoming: rows.filter(r => r.month >= today && r.status !== 'cancelled' && r.status !== 'rejected').length,
    pending: rows.filter(r => r.status === 'pending').length,
    all: rows.length,
  }), [rows, today])

  const visible = rows.filter(r => {
    if (filter === 'upcoming') return r.month >= today && r.status !== 'cancelled' && r.status !== 'rejected'
    if (filter === 'pending') return r.status === 'pending'
    return true
  })

  const grouped = useMemo(() => {
    const map = new Map<string, SpotlightRow[]>()
    for (const r of visible) {
      const k = r.month.slice(0, 7) // YYYY-MM
      const list = map.get(k) ?? []
      list.push(r)
      map.set(k, list)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [visible])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 flex-wrap">
          {([
            ['upcoming', 'Upcoming'],
            ['pending', 'Pending review'],
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
        <Button onClick={() => setScheduleOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Schedule slot
        </Button>
      </div>

      {grouped.length === 0 ? (
        <div className="bg-card border border-border rounded-xl text-center py-12 text-sm text-muted-foreground">
          No spotlight slots in this view.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([yyyymm, items]) => (
            <div key={yyyymm} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-border bg-muted/30">
                <h2 className="font-semibold text-sm">
                  {format(parseISO(`${yyyymm}-01`), 'MMMM yyyy')}
                </h2>
              </div>
              <ul className="divide-y divide-border">
                {items.map(row => <SpotlightRowItem key={row.id} row={row} />)}
              </ul>
            </div>
          ))}
        </div>
      )}

      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} />
    </div>
  )
}

function SpotlightRowItem({ row }: { row: SpotlightRow }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [rejectOpen, setRejectOpen] = useState(false)
  const biz = row.businesses

  const approve = () =>
    startTransition(async () => {
      const res = await approveSpotlight(row.id)
      if (!res.error) router.refresh()
    })

  const cancel = () =>
    startTransition(async () => {
      const res = await cancelSpotlight(row.id)
      if (!res.error) router.refresh()
    })

  return (
    <li className="p-4 hover:bg-muted/20 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <Avatar className="h-10 w-10 shrink-0 rounded-lg">
          <AvatarImage src={biz?.logo_url ?? undefined} className="rounded-lg" />
          <AvatarFallback className="rounded-lg bg-primary/15 text-primary text-xs font-bold">
            {(biz?.name ?? '?').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/marketplace/${row.business_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:text-primary inline-flex items-center gap-1"
            >
              {biz?.name ?? '(unknown business)'}
              <ExternalLink className="h-3 w-3" />
            </Link>
            <Badge className={cn('border capitalize text-[10px]', STATUS_VARIANTS[row.status])}>
              {row.status}
            </Badge>
            {row.type && (
              <Badge className={cn('border capitalize text-[10px]', TYPE_VARIANTS[row.type])}>
                {row.type}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {[biz?.city, biz?.country].filter(Boolean).join(', ') || '—'}
            {row.nominator?.full_name && ` · nominated by ${row.nominator.full_name}`}
            {row.approver?.full_name && row.status !== 'pending' && ` · ${row.status} by ${row.approver.full_name}`}
          </p>
          {row.rejection_reason && (
            <p className="text-xs mt-2 p-2 rounded-md bg-muted/40 border border-border">
              <span className="font-medium">Reason:</span> {row.rejection_reason}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          {row.status === 'pending' && (
            <>
              <Button size="sm" onClick={approve} disabled={isPending} className="gap-1.5">
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRejectOpen(true)}
                disabled={isPending}
                className="text-destructive hover:text-destructive gap-1.5"
              >
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
            </>
          )}
          {row.status === 'approved' && (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
                  Cancel slot
                </Button>
              }
              title="Cancel this spotlight?"
              description={
                <>
                  Cancel the spotlight for <strong className="text-foreground">{biz?.name}</strong> in{' '}
                  <strong className="text-foreground">{format(parseISO(row.month), 'MMMM yyyy')}</strong>?
                </>
              }
              confirmLabel="Cancel slot"
              onConfirm={async () => { await new Promise<void>(res => { cancel(); res() }) }}
            />
          )}
        </div>
      </div>

      <RejectDialog row={row} open={rejectOpen} onOpenChange={setRejectOpen} />
    </li>
  )
}

function RejectDialog({
  row, open, onOpenChange,
}: { row: SpotlightRow; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleOpenChange = (v: boolean) => {
    if (!v) { setNote(''); setError(null) }
    onOpenChange(v)
  }

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const res = await rejectSpotlight(row.id, note)
      if (res.error) { setError(res.error); return }
      handleOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject spotlight nomination?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            The nominator will see this note. Be specific about what to change.
          </p>
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. The business profile is incomplete — ask the member to finalise their listing first."
            rows={4}
            maxLength={500}
            className="resize-none"
          />
          <p className="text-[11px] text-muted-foreground text-right">{note.length}/500</p>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={isPending || note.trim().length < 3}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? 'Rejecting…' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScheduleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SpotlightBusinessResult[]>([])
  const [picked, setPicked] = useState<SpotlightBusinessResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [month, setMonth] = useState('')
  const [type, setType] = useState<SpotlightType>('rotated')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setQuery(''); setResults([]); setPicked(null); setMonth(''); setType('rotated'); setError(null)
    }
    onOpenChange(v)
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) return
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const res = await searchBusinessesForSpotlight(query)
      setSearching(false)
      if (!res.error) setResults(res.results)
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const submit = () => {
    setError(null)
    if (!picked) { setError('Pick a business'); return }
    if (!month) { setError('Pick a month'); return }
    startTransition(async () => {
      const res = await scheduleSpotlight({
        business_id: picked.id,
        month_yyyy_mm: month,
        type,
      })
      if (res.error) { setError(res.error); return }
      handleOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule spotlight slot</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {!picked ? (
            <>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search published businesses by name…"
                  className="pl-9"
                />
              </div>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {query.trim().length < 2 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Type at least 2 characters.</p>
                ) : searching ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Searching…</p>
                ) : results.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No matches.</p>
                ) : (
                  results.map(r => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setPicked(r)}
                      className="w-full text-left p-2 hover:bg-muted/40"
                    >
                      <p className="text-sm font-medium">{r.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {[r.city, r.country].filter(Boolean).join(', ') || '—'}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="p-3 rounded-lg bg-muted/30 border border-border flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{picked.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {[picked.city, picked.country].filter(Boolean).join(', ') || '—'}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setPicked(null)}>Change</Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1">Month</label>
              <Input
                type="month"
                value={month}
                onChange={e => setMonth(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Type</label>
              <div className="flex gap-1">
                {(['rotated', 'paid'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      'flex-1 px-3 py-1.5 rounded-lg text-xs font-medium capitalize',
                      type === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={submit} disabled={isPending || !picked || !month}>
            {isPending ? 'Scheduling…' : 'Schedule slot'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
