'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  submitCsvImportAsAdmin,
  approveCsvImport,
  rejectCsvImport,
  markCsvImportProcessed,
  type CsvImportRow,
} from '@/actions/imports'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { format, formatDistanceToNow } from 'date-fns'
import { Upload, FileSpreadsheet, Check, X, PlayCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Status = 'pending' | 'approved' | 'rejected' | 'processed'
type Source = 'admin' | 'chapter_manager'

export interface ImportRow {
  id: string
  source: Source
  row_count: number
  status: Status
  rejection_reason: string | null
  chapter_id: number | null
  reviewed_at: string | null
  processed_at: string | null
  created_at: string
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

  const submitter = row.submitted

  const approve = () =>
    startTransition(async () => {
      const res = await approveCsvImport(row.id)
      if (!res.error) router.refresh()
    })

  const process = () =>
    startTransition(async () => {
      const res = await markCsvImportProcessed(row.id)
      if (!res.error) router.refresh()
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
          </div>
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
            <Button size="sm" variant="outline" onClick={process} disabled={isPending} className="gap-1.5">
              <PlayCircle className="h-3.5 w-3.5" /> Mark processed
            </Button>
          )}
        </div>
      </div>

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

// ── Upload flow ───────────────────────────────────────────────

const REQUIRED_HEADERS = ['email', 'full_name'] as const
const OPTIONAL_HEADERS = ['business_name', 'business_url', 'linkedin_url', 'region', 'country', 'city'] as const
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
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <strong className="text-foreground">Required columns:</strong> {REQUIRED_HEADERS.join(', ')}
            </p>
            <p>
              <strong className="text-foreground">Optional columns:</strong> {OPTIONAL_HEADERS.join(', ')}
            </p>
            <p>Up to 2,000 rows per upload, 1 MB file size limit.</p>
          </div>

          {!parsed ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isPending}
              className="w-full border-2 border-dashed border-border rounded-lg p-8 hover:border-primary hover:bg-muted/30 transition-colors disabled:opacity-50"
            >
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Upload className="h-6 w-6" />
                <p className="text-sm font-medium">Click to choose a CSV file</p>
              </div>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Preview · {parsed.rows.length} valid rows</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setParsed(null); if (fileRef.current) fileRef.current.value = '' }}
                  disabled={isPending}
                >
                  Choose different file
                </Button>
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
              <div className="rounded-lg border border-border overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium">Email</th>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-left p-2 font-medium">Business</th>
                      <th className="text-left p-2 font-medium">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-2 text-muted-foreground">{r.email}</td>
                        <td className="p-2">{r.full_name}</td>
                        <td className="p-2 text-muted-foreground">{r.business_name || '—'}</td>
                        <td className="p-2 text-muted-foreground">
                          {[r.city, r.country].filter(Boolean).join(', ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 50 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2 border-t border-border">
                    Showing first 50 of {parsed.rows.length}
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
    if (!obj.email || !obj.full_name) {
      warnings.push(`Row ${i + 1} skipped — missing email or full_name`)
      continue
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj.email)) {
      warnings.push(`Row ${i + 1} skipped — invalid email "${obj.email}"`)
      continue
    }
    rows.push({
      email: obj.email.toLowerCase(),
      full_name: obj.full_name,
      business_name: obj.business_name || '',
      business_url: obj.business_url || '',
      linkedin_url: obj.linkedin_url || '',
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
