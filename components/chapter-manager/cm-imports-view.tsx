'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitChapterCsvImport } from '@/actions/chapter-manager'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { format, formatDistanceToNow } from 'date-fns'
import { Upload, FileSpreadsheet } from 'lucide-react'
import { cn } from '@/lib/utils'

type Status = 'pending' | 'approved' | 'rejected' | 'processed'

export interface CmImportRow {
  id: string
  source: string
  row_count: number
  status: Status
  rejection_reason: string | null
  reviewed_at: string | null
  processed_at: string | null
  created_at: string
}

const STATUS_VARIANTS: Record<Status, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  approved: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  rejected: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  processed: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
}

interface ParsedRow {
  email: string
  full_name: string
  business_name?: string
  business_url?: string
  linkedin_url?: string
  region?: string
  country?: string
  city?: string
}

const REQUIRED_HEADERS = ['email', 'full_name', 'business_url'] as const
const OPTIONAL_HEADERS = ['linkedin_url', 'business_name', 'region', 'country', 'city'] as const
const ALL_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS]

export function CmImportsView({
  chapterId, history,
}: { chapterId: number; history: CmImportRow[] }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<{ rows: ParsedRow[]; warnings: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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
      const res = await submitChapterCsvImport({ chapter_id: chapterId, rows: parsed.rows })
      if (res.error) { setError(res.error); return }
      setParsed(null)
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Upload card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="space-y-2">
          <h2 className="font-semibold">Submit a new roster</h2>
          <div className="space-y-1">
            <div className="flex items-start gap-2 text-xs">
              <span className="font-semibold text-foreground shrink-0 mt-0.5">Required columns:</span>
              <div className="flex flex-wrap gap-1">
                {REQUIRED_HEADERS.map(h => (
                  <span key={h} className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[11px] font-mono">{h}</span>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-2 text-xs">
              <span className="font-semibold text-foreground shrink-0 mt-0.5">Optional columns:</span>
              <div className="flex flex-wrap gap-1">
                {OPTIONAL_HEADERS.map(h => (
                  <span key={h} className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded text-[11px] font-mono">{h}</span>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Up to 2,000 rows per upload · 1 MB file size limit</p>
          </div>
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
            <p className="text-sm font-medium">Preview · {parsed.rows.length} valid rows</p>
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
            <div className="rounded-lg border border-border overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Email</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Business</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {parsed.rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground max-w-45 truncate">{r.email}</td>
                      <td className="px-3 py-2 font-medium">{r.full_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.business_name || <span className="text-border">—</span>}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {[r.city, r.country].filter(Boolean).join(', ') || <span className="text-border">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 50 && (
                <p className="text-[11px] text-muted-foreground text-center py-2 border-t border-border bg-muted/20">
                  Showing first 50 of {parsed.rows.length} rows
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button onClick={submit} disabled={isPending} className="gap-1.5 flex-1">
                <FileSpreadsheet className="h-4 w-4" />
                {isPending ? 'Submitting…' : `Submit ${parsed.rows.length} rows for review`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setParsed(null); if (fileRef.current) fileRef.current.value = '' }}
                disabled={isPending}
              >
                Cancel
              </Button>
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

      {/* History */}
      <div>
        <h2 className="font-semibold mb-2">Your submission history</h2>
        {history.length === 0 ? (
          <div className="bg-card border border-border rounded-xl text-center py-10 text-sm text-muted-foreground">
            You haven&apos;t submitted any imports yet.
          </div>
        ) : (
          <ul className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
            {history.map(r => <HistoryRow key={r.id} row={r} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

function HistoryRow({ row }: { row: CmImportRow }) {
  return (
    <li className="p-3">
      <div className="flex items-center gap-3 flex-wrap">
        <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium">{row.row_count} rows</p>
        <Badge className={cn('border capitalize text-[10px]', STATUS_VARIANTS[row.status])}>
          {row.status}
        </Badge>
        <span className="text-xs text-muted-foreground" title={format(new Date(row.created_at), 'PPpp')}>
          {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
        </span>
        {row.reviewed_at && (
          <span className="text-[11px] text-muted-foreground">
            · reviewed {formatDistanceToNow(new Date(row.reviewed_at), { addSuffix: true })}
          </span>
        )}
      </div>
      {row.rejection_reason && (
        <p className="text-xs mt-2 p-2 rounded-md bg-muted/40 border border-border">
          <span className="font-medium">Admin note:</span> {row.rejection_reason}
        </p>
      )}
    </li>
  )
}

/** Same parser as components/admin/imports-list.tsx — kept inline because
 *  the two pages have slightly different submit flows and extracting a
 *  shared parser would force a /lib detour for ~80 lines that don't
 *  appear anywhere else. */
function parseCsv(text: string): { error: string | null; rows: ParsedRow[]; warnings: string[] } {
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

  const rows: ParsedRow[] = []
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

  if (rows.length === 0) return { error: 'No valid rows after parsing', rows: [], warnings }
  if (rows.length > 2000) return { error: 'Imports are capped at 2,000 rows', rows: [], warnings }
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
