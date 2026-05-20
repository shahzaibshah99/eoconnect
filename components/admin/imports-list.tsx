'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  submitCsvImportAsAdmin,
  approveCsvImport,
  rejectCsvImport,
  markCsvImportProcessed,
  processCsvBatch,
  type CsvImportRow,
} from '@/actions/imports'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { format, formatDistanceToNow } from 'date-fns'
import { Upload, FileSpreadsheet, Check, X, PlayCircle, Info, ChevronDown, ChevronUp, CheckCircle2, Clock } from 'lucide-react'
import { getImportClaimStatus } from '@/actions/imports'
import { cn } from '@/lib/utils'

type Status = 'pending' | 'approved' | 'rejected' | 'processed'
type Source = 'admin' | 'chapter_manager'

export interface ImportRow {
  id: string
  source: Source
  row_count: number
  processed_count: number
  status: Status
  rejection_reason: string | null
  chapter_id: number | null
  reviewed_at: string | null
  processed_at: string | null
  created_at: string
  payload?: {
    rows?: Array<{ email: string; full_name?: string }>
    result?: {
      created: number
      skipped: number
      rowErrors: string[]
      emailErrors: string[]
    }
  } | null
  submitted: { full_name: string | null; avatar_url: string | null; eo_membership_email: string | null } | null
  reviewer: { full_name: string | null } | null
  eo_chapters: { name: string } | null
}

const STATUS_VARIANTS: Record<Status, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  approved: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  rejected: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  processed: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
}

export function ImportsList({ rows, canUpload }: { rows: ImportRow[]; canUpload: boolean }) {
  const [filter, setFilter] = useState<'all' | Status>('pending')
  const [uploadOpen, setUploadOpen] = useState(false)

  const counts = useMemo(() => {
    const c: Record<Status, number> = { pending: 0, approved: 0, rejected: 0, processed: 0 }
    for (const r of rows) c[r.status]++
    return c
  }, [rows])

  const visible = rows.filter(r => filter === 'all' || r.status === filter)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 flex-wrap">
          {(['pending', 'approved', 'rejected', 'processed', 'all'] as const).map(s => (
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
        {canUpload && (
          <Button onClick={() => setUploadOpen(true)} className="gap-1.5">
            <Upload className="h-4 w-4" /> New upload
          </Button>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {visible.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No imports in this filter yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map(row => <ImportRowItem key={row.id} row={row} />)}
          </ul>
        )}
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  )
}

function ImportRowItem({ row }: { row: ImportRow }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [processResult, setProcessResult] = useState<{
    created: number; skipped: number; rowErrors: string[]; emailErrors: string[]
  } | null>(null)
  const [processError, setProcessError] = useState<string | null>(null)

  const submitter = row.submitted

  const approve = () =>
    startTransition(async () => {
      setProcessResult(null)
      setProcessError(null)
      const res = await approveCsvImport(row.id)
      if (res.error) {
        setProcessError(res.error)
      } else {
        router.refresh()
      }
    })

  const process = () =>
    startTransition(async () => {
      setProcessResult(null)
      setProcessError(null)
      const res = await markCsvImportProcessed(row.id)
      if (res.error) {
        setProcessError(res.error)
      } else {
        setProcessResult({
          created: res.created ?? 0,
          skipped: res.skipped ?? 0,
          rowErrors: res.rowErrors ?? [],
          emailErrors: res.emailErrors ?? [],
        })
        router.refresh()
      }
    })

  return (
    <li className="p-4 hover:bg-muted/20 transition-colors">
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={submitter?.avatar_url ?? undefined} />
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
              {(submitter?.full_name ?? '?').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm">{submitter?.full_name ?? 'Unknown'}</p>
              <Badge className={cn('border capitalize text-[10px]', STATUS_VARIANTS[row.status])}>
                {row.status}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {row.source === 'admin' ? 'Direct upload' : 'Chapter manager'}
              </Badge>
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <FileSpreadsheet className="h-3 w-3" />
                {row.row_count} rows
              </span>
              {row.eo_chapters && (
                <Badge variant="secondary" className="text-[10px]">{row.eo_chapters.name}</Badge>
              )}
            </div>
            {submitter?.eo_membership_email && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{submitter.eo_membership_email}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1" title={format(new Date(row.created_at), 'PPpp')}>
              Submitted {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
              {row.reviewer?.full_name && row.reviewed_at && (
                <> · reviewed by {row.reviewer.full_name} {formatDistanceToNow(new Date(row.reviewed_at), { addSuffix: true })}</>
              )}
            </p>
            {row.rejection_reason && (
              <p className="text-xs mt-2 p-2 rounded-md bg-muted/40 border border-border">
                <span className="font-medium">Reason:</span> {row.rejection_reason}
              </p>
            )}
            {/* Progress bar — auto-starts when import is approved */}
            {row.status === 'approved' && (
              <BatchProgressBar
                importId={row.id}
                totalRows={row.row_count}
                initialProcessed={row.processed_count ?? 0}
              />
            )}
            {/* (i) icon — shows processing result for processed imports */}
            {row.status === 'processed' && row.payload?.result && (
              <ProcessingResult result={row.payload.result} />
            )}
            {/* Claim status — shows per-email claimed/pending for processed imports */}
            {row.status === 'processed' && row.payload?.rows && row.payload.rows.length > 0 && (
              <ClaimStatus emails={row.payload.rows.map(r => r.email).filter(Boolean)} />
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          {row.status === 'pending' && (
            <>
              <Button size="sm" onClick={approve} disabled={isPending} className="gap-1.5">
                <Check className="h-3.5 w-3.5" />
                {isPending ? 'Approving…' : 'Approve'}
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
        </div>
      </div>

      {processError && (
        <div className="mt-3 text-xs rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-red-700 dark:text-red-400">
          <p className="font-semibold mb-1">Error — no listings created</p>
          <p className="font-mono">{processError}</p>
        </div>
      )}

      {processResult && (
        <div className="mt-3 space-y-2">
          <div className={`text-xs rounded-lg px-3 py-2 border ${processResult.created > 0 ? 'bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-700 dark:text-yellow-400'}`}>
            {processResult.created > 0
              ? <>✓ <strong>{processResult.created}</strong> listings created and claim emails queued</>
              : '⚠ 0 listings created — see errors below'
            }
            {processResult.skipped > 0 && <> · <strong>{processResult.skipped}</strong> skipped (email already on file)</>}
          </div>
          {processResult.rowErrors.length > 0 && (
            <div className="text-xs rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-red-700 dark:text-red-400">
              <p className="font-semibold mb-1">Listing creation errors:</p>
              <ul className="space-y-0.5 list-disc pl-4 font-mono">
                {processResult.rowErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {processResult.emailErrors.length > 0 && (
            <div className="text-xs rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-yellow-700 dark:text-yellow-400">
              <p className="font-semibold mb-1">Email delivery errors (listings still created):</p>
              <ul className="space-y-0.5 list-disc pl-4 font-mono">
                {processResult.emailErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <RejectDialog row={row} open={rejectOpen} onOpenChange={setRejectOpen} />
    </li>
  )
}

function RejectDialog({
  row, open, onOpenChange,
}: { row: ImportRow; open: boolean; onOpenChange: (v: boolean) => void }) {
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
      const res = await rejectCsvImport(row.id, note)
      if (res.error) { setError(res.error); return }
      handleOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject this import?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            The submitter will see this note. Be specific about what to fix.
          </p>
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Email column has 12 rows with malformed addresses — please re-validate before resubmitting."
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

// ── Batch progress bar ────────────────────────────────────────
//
// Shown automatically when an import moves to 'approved' status.
// Drives batch processing client-side: calls processCsvBatch() in a loop
// with a 50-row batch size. Survives page refresh — resumes from
// processed_count stored in DB.

const BATCH_SIZE = 50

function BatchProgressBar({
  importId,
  totalRows,
  initialProcessed,
}: {
  importId: string
  totalRows: number
  initialProcessed: number
}) {
  const router = useRouter()
  const [processed, setProcessed] = useState(initialProcessed)
  const [stats, setStats] = useState({ created: 0, skipped: 0, errors: 0 })
  const [rowErrors, setRowErrors] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [processingError, setProcessingError] = useState<string | null>(null)
  const [startTime] = useState(Date.now())
  const isRunning = useRef(false)

  useEffect(() => {
    if (isRunning.current || done || processed >= totalRows) return
    isRunning.current = true

    const run = async () => {
      let offset = initialProcessed
      while (offset < totalRows) {
        const res = await processCsvBatch(importId, offset, BATCH_SIZE)
        if (res.error) { setProcessingError(res.error); break }
        setProcessed(res.processedSoFar)
        setStats(prev => ({
          created: prev.created + res.batchCreated,
          skipped: prev.skipped + res.batchSkipped,
          errors: prev.errors + res.batchRowErrors.length,
        }))
        if (res.batchRowErrors.length > 0) {
          setRowErrors(prev => [...prev, ...res.batchRowErrors])
        }
        if (res.done) {
          setDone(true)
          // Only auto-refresh if no errors — otherwise keep errors visible
          if (res.batchRowErrors.length === 0 && !processingError) {
            router.refresh()
          }
          break
        }
        offset = res.processedSoFar
      }
      isRunning.current = false
    }

    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pct = totalRows > 0 ? Math.min(100, Math.round((processed / totalRows) * 100)) : 0
  const elapsed = (Date.now() - startTime) / 1000
  const rate = processed > initialProcessed ? (processed - initialProcessed) / elapsed : 0
  const remaining = rate > 0 ? Math.round((totalRows - processed) / rate) : null

  const fmtTime = (s: number) => {
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.round(s / 60)}m`
    return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">
          {done ? 'Complete' : `Processing…`} — {processed} / {totalRows}
        </span>
        {!done && remaining !== null && <span>~{fmtTime(remaining)} remaining</span>}
        {done && <span className="text-green-600 font-semibold">Done ✓</span>}
      </div>

      {/* Progress bar */}
      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-green-500' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Stats */}
      <div className="flex gap-3 text-[11px]">
        <span className="font-bold">{pct}%</span>
        <span className="text-green-600">✓ {stats.created} created</span>
        {stats.skipped > 0 && <span className="text-muted-foreground">↷ {stats.skipped} skipped</span>}
        {stats.errors > 0 && <span className="text-destructive">✗ {stats.errors} errors</span>}
      </div>

      {processingError && (
        <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1 font-mono">{processingError}</p>
      )}
      {rowErrors.length > 0 && (
        <div className="text-xs bg-destructive/10 border border-destructive/20 rounded p-2 space-y-1">
          <p className="font-semibold text-destructive">Row errors — check terminal for details:</p>
          {rowErrors.map((e, i) => (
            <p key={i} className="font-mono text-destructive/80 break-all">{e}</p>
          ))}
          {done && <button onClick={() => router.refresh()} className="mt-1 text-xs underline text-muted-foreground">Dismiss and refresh</button>}
        </div>
      )}
    </div>
  )
}

// ── Claim status for a processed import ──────────────────────

function ClaimStatus({ emails }: { emails: string[] }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{
    claimed: number; pending: number
    details: Array<{ email: string; claimed: boolean; claimed_by: string | null; claimed_at: string | null }>
  } | null>(null)

  const load = async () => {
    if (data) { setOpen(v => !v); return }
    setLoading(true)
    const res = await getImportClaimStatus(emails)
    if (!res.error) setData(res)
    setLoading(false)
    setOpen(true)
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {loading ? (
          <span className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        ) : open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Claim status
        {data && (
          <span className="ml-1 font-medium text-green-600 dark:text-green-400">
            {data.claimed}/{data.claimed + data.pending} claimed
          </span>
        )}
      </button>

      {open && data && (
        <div className="mt-2 rounded-lg border border-border bg-muted/30 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="text-left px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Email</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Claimed by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.details.map(d => (
                <tr key={d.email} className={d.claimed ? 'bg-green-500/5' : ''}>
                  <td className="px-3 py-1.5 font-mono truncate max-w-[180px]" title={d.email}>{d.email}</td>
                  <td className="px-3 py-1.5">
                    {d.claimed ? (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
                        <CheckCircle2 className="h-3 w-3" /> Claimed
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                        <Clock className="h-3 w-3" /> Pending
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {d.claimed_by ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Processing result (i) icon ───────────────────────────────

function ProcessingResult({ result }: {
  result: { created: number; skipped: number; rowErrors: string[]; emailErrors: string[] }
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" />
        Processing details
      </button>
      {open && (
        <div className="mt-2 p-3 rounded-lg bg-muted/40 border border-border text-xs space-y-1.5">
          <p className={result.created > 0 ? 'text-green-700 dark:text-green-400 font-medium' : 'text-muted-foreground'}>
            ✓ {result.created} listing{result.created !== 1 ? 's' : ''} created · claim emails sent
          </p>
          {result.skipped > 0 && (
            <p className="text-muted-foreground">
              ↷ {result.skipped} skipped (email already on file)
            </p>
          )}
          {result.rowErrors.length > 0 && (
            <div>
              <p className="text-red-600 font-medium mb-0.5">Listing errors:</p>
              <ul className="list-disc pl-4 space-y-0.5 font-mono text-red-700 dark:text-red-400">
                {result.rowErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {result.emailErrors.length > 0 && (
            <div>
              <p className="text-yellow-700 font-medium mb-0.5">Email errors:</p>
              <ul className="list-disc pl-4 space-y-0.5 font-mono">
                {result.emailErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Upload flow ───────────────────────────────────────────────

const REQUIRED_HEADERS = ['email', 'full_name', 'business_url'] as const
const OPTIONAL_HEADERS = ['linkedin_url', 'business_name', 'region', 'country', 'city'] as const
const ALL_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS]

function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<{ rows: CsvImportRow[]; warnings: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setParsed(null)
      setError(null)
      if (fileRef.current) fileRef.current.value = ''
    }
    onOpenChange(v)
  }

  const onFile = async (file: File | null) => {
    setError(null)
    setParsed(null)
    if (!file) return

    if (file.size > 1024 * 1024) {
      setError('CSV must be under 1 MB')
      return
    }
    const text = await file.text()
    const result = parseCsv(text)
    if (result.error) {
      setError(result.error)
      return
    }
    setParsed({ rows: result.rows, warnings: result.warnings })
  }

  const submit = () => {
    if (!parsed) return
    setError(null)
    startTransition(async () => {
      const res = await submitCsvImportAsAdmin({ rows: parsed.rows, chapter_id: null })
      if (res.error) { setError(res.error); return }
      handleOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload member roster CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Column reference box */}
          <div className="rounded-lg border border-border bg-muted/40 divide-y divide-border text-xs">
            <div className="flex items-center gap-3 px-3 py-2">
              <span className="w-16 shrink-0 font-medium text-foreground">Required</span>
              <span className="font-mono text-primary">{REQUIRED_HEADERS.join(', ')}</span>
            </div>
            <div className="flex items-start gap-3 px-3 py-2">
              <span className="w-16 shrink-0 font-medium text-foreground pt-px">Optional</span>
              <span className="font-mono text-muted-foreground leading-relaxed">{OPTIONAL_HEADERS.join(', ')}</span>
            </div>
            <div className="px-3 py-2 text-muted-foreground">
              Up to 2,000 rows · 1 MB file size limit
            </div>
            <div className="px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400 border-t border-border bg-amber-500/5">
              ⚠ <strong>linkedin_url</strong> must be a company page — e.g. linkedin.com/<strong>company</strong>/remap-ai. Personal profile URLs (/in/...) will be rejected.
            </div>
          </div>

          {!parsed ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isPending}
              className="w-full border-2 border-dashed border-border rounded-lg p-10 hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 group"
            >
              <div className="flex flex-col items-center gap-2 text-muted-foreground group-hover:text-primary transition-colors">
                <Upload className="h-7 w-7" />
                <p className="text-sm font-medium">Click to choose a CSV file</p>
              </div>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{parsed.rows.length} valid rows ready</p>
                <button
                  type="button"
                  onClick={() => { setParsed(null); if (fileRef.current) fileRef.current.value = '' }}
                  disabled={isPending}
                  className="text-xs text-primary hover:underline disabled:opacity-50"
                >
                  Choose different file
                </button>
              </div>

              {parsed.warnings.length > 0 && (
                <Alert>
                  <AlertDescription>
                    <p className="font-medium mb-1">Warnings ({parsed.warnings.length})</p>
                    <ul className="text-xs list-disc pl-4 space-y-0.5">
                      {parsed.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                      {parsed.warnings.length > 5 && <li>…and {parsed.warnings.length - 5} more</li>}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div className="rounded-lg border border-border overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <colgroup>
                    <col className="w-[30%]" />
                    <col className="w-[20%]" />
                    <col className="w-[50%]" />
                  </colgroup>
                  <thead className="sticky top-0 bg-muted border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground tracking-wide uppercase text-[10px]">Email</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground tracking-wide uppercase text-[10px]">Name</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground tracking-wide uppercase text-[10px]">Business URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {parsed.rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="hover:bg-muted/40 transition-colors">
                        <td className="px-3 py-2.5 text-muted-foreground truncate" title={r.email}>{r.email}</td>
                        <td className="px-3 py-2.5 font-medium truncate">{r.full_name}</td>
                        <td className="px-3 py-2.5 text-muted-foreground truncate font-mono text-[10px]" title={r.business_url}>
                          {r.business_url || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 50 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2 border-t border-border bg-muted/30">
                    Showing first 50 of {parsed.rows.length} rows
                  </p>
                )}
              </div>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => onFile(e.target.files?.[0] ?? null)}
          />

          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!parsed || isPending}>
            {isPending ? 'Submitting…' : `Submit ${parsed?.rows.length ?? 0} rows for review`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Tiny CSV parser. Handles quoted fields with embedded commas and
 * escaped double quotes ("" inside a quoted field). Stops at malformed
 * input rather than guessing — easier to fix the source than debug a
 * silently dropped row downstream.
 */
function parseCsv(text: string): {
  error: string | null
  rows: CsvImportRow[]
  warnings: string[]
} {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return { error: 'CSV must have a header row and at least one data row', rows: [], warnings: [] }

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim())

  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      return { error: `Missing required column: ${required}`, rows: [], warnings: [] }
    }
  }
  const unknownHeaders = headers.filter(h => !ALL_HEADERS.includes(h as (typeof ALL_HEADERS)[number]))
  const warnings: string[] = []
  if (unknownHeaders.length) {
    warnings.push(`Ignoring unknown columns: ${unknownHeaders.join(', ')}`)
  }

  const rows: CsvImportRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i])
    const obj: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (fields[j] ?? '').trim()
    }
    if (!obj.email || !obj.full_name || !obj.business_url) {
      warnings.push(`Row ${i + 1} skipped — missing email, full_name, or business_url`)
      continue
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj.email)) {
      warnings.push(`Row ${i + 1} skipped — invalid email "${obj.email}"`)
      continue
    }
    if (obj.linkedin_url && /linkedin\.com\/in\//i.test(obj.linkedin_url)) {
      warnings.push(`Row ${i + 1} skipped — linkedin_url is a personal profile (/in/). Use the company page URL (/company/...) instead.`)
      continue
    }
    // Auto-add https:// if protocol is missing so members don't
    // need to type it — 'fernwoodfitness.com.au' becomes valid.
    const rawUrl = obj.business_url?.trim() || ''
    const businessUrl = rawUrl && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')
      ? `https://${rawUrl}`
      : rawUrl
    const rawLiUrl = obj.linkedin_url?.trim() || ''
    const linkedinUrl = rawLiUrl && !rawLiUrl.startsWith('http://') && !rawLiUrl.startsWith('https://')
      ? `https://${rawLiUrl}`
      : rawLiUrl

    rows.push({
      email: obj.email.toLowerCase(),
      full_name: obj.full_name,
      business_name: obj.business_name || '',
      business_url: businessUrl,
      linkedin_url: linkedinUrl,
      region: obj.region || '',
      country: obj.country || '',
      city: obj.city || '',
    })
  }

  if (rows.length === 0) {
    return { error: 'No valid rows after parsing', rows: [], warnings }
  }
  if (rows.length > 2000) {
    return { error: 'Imports are capped at 2,000 rows', rows: [], warnings }
  }

  return { error: null, rows, warnings }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let i = 0
  let cur = ''
  let inQuotes = false
  while (i < line.length) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 2; continue }
        inQuotes = false
        i++
        continue
      }
      cur += c
      i++
      continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { out.push(cur); cur = ''; i++; continue }
    cur += c
    i++
  }
  out.push(cur)
  return out
}
