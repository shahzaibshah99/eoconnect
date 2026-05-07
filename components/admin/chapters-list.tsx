'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  assignChapterManager,
  removeChapterManager,
  setChapterSponsorSlots,
  searchMembersForChapter,
  type ChapterMemberSearchResult,
} from '@/actions/chapters'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { UserPlus, Search, Globe2, Users, Star, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ChapterManager {
  assignment_id: string
  member_id: string
  full_name: string | null
  avatar_url: string | null
  email: string | null
  created_at: string
}

export interface ChapterRow {
  id: number
  name: string
  region: string
  country: string | null
  city: string | null
  virtual: boolean
  sponsor_slots: number
  member_count: number
  managers: ChapterManager[]
}

export function ChaptersList({ rows }: { rows: ChapterRow[] }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'with-managers' | 'no-managers' | 'with-sponsors'>('all')

  const counts = useMemo(() => ({
    all: rows.length,
    'with-managers': rows.filter(r => r.managers.length > 0).length,
    'no-managers': rows.filter(r => r.managers.length === 0).length,
    'with-sponsors': rows.filter(r => r.sponsor_slots > 0).length,
  }), [rows])

  const visible = rows.filter(r => {
    if (filter === 'with-managers' && r.managers.length === 0) return false
    if (filter === 'no-managers' && r.managers.length > 0) return false
    if (filter === 'with-sponsors' && r.sponsor_slots === 0) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        r.name.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        r.country?.toLowerCase().includes(q) ||
        r.city?.toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
        <input
          placeholder="Search by chapter, region, or city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 h-9 px-3 rounded-lg bg-background border border-border text-sm"
        />
        <div className="flex gap-1 flex-wrap">
          {([
            ['all', 'All'],
            ['with-managers', 'With managers'],
            ['no-managers', 'No managers'],
            ['with-sponsors', 'Sponsor slots'],
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
          No chapters match this filter.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map(row => <ChapterRowItem key={row.id} row={row} />)}
        </ul>
      )}
    </div>
  )
}

function ChapterRowItem({ row }: { row: ChapterRow }) {
  const [assignOpen, setAssignOpen] = useState(false)

  const subtitle = [
    row.region,
    row.country,
    row.city,
  ].filter(Boolean).join(' · ')

  return (
    <li className="p-4 hover:bg-muted/20 transition-colors">
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{row.name}</h3>
            {row.virtual && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Globe2 className="h-3 w-3" /> Virtual
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {row.member_count} {row.member_count === 1 ? 'member' : 'members'}
            </span>
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5" />
              {row.sponsor_slots} sponsor {row.sponsor_slots === 1 ? 'slot' : 'slots'}
            </span>
            <span>
              {row.managers.length} {row.managers.length === 1 ? 'manager' : 'managers'}
            </span>
          </div>
        </div>

        {/* Managers */}
        <div className="lg:w-80 shrink-0">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
              Chapter managers
            </p>
            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setAssignOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Assign
            </Button>
          </div>
          {row.managers.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">None assigned</p>
          ) : (
            <ul className="space-y-1.5">
              {row.managers.map(m => <ManagerChip key={m.assignment_id} manager={m} />)}
            </ul>
          )}
        </div>

        {/* Sponsor slots */}
        <div className="lg:w-32 shrink-0">
          <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground mb-2">
            Sponsor slots
          </p>
          <SlotEditor chapterId={row.id} chapterName={row.name} initialSlots={row.sponsor_slots} />
        </div>
      </div>

      <AssignManagerDialog
        chapterId={row.id}
        chapterName={row.name}
        existingMemberIds={row.managers.map(m => m.member_id)}
        open={assignOpen}
        onOpenChange={setAssignOpen}
      />
    </li>
  )
}

function ManagerChip({ manager }: { manager: ChapterManager }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const remove = () => {
    startTransition(async () => {
      const res = await removeChapterManager(manager.assignment_id)
      if (res.error) throw new Error(res.error)
      router.refresh()
    })
  }

  return (
    <li className="flex items-center gap-2 p-1.5 rounded-md bg-muted/30 hover:bg-muted/50">
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarImage src={manager.avatar_url ?? undefined} />
        <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-bold">
          {(manager.full_name ?? '?').charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{manager.full_name ?? '—'}</p>
        {manager.email && (
          <p className="text-[10px] text-muted-foreground truncate">{manager.email}</p>
        )}
      </div>
      <ConfirmDialog
        trigger={
          <button
            type="button"
            disabled={isPending}
            className="h-5 w-5 rounded hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
            aria-label="Remove manager"
          >
            <X className="h-3 w-3" />
          </button>
        }
        title="Remove chapter manager?"
        description={
          <>
            Remove <strong className="text-foreground">{manager.full_name ?? 'this member'}</strong> as a chapter manager?
            They&apos;ll lose access to the Chapter Manager panel for this chapter.
          </>
        }
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </li>
  )
}

function SlotEditor({
  chapterId, chapterName, initialSlots,
}: { chapterId: number; chapterName: string; initialSlots: number }) {
  const router = useRouter()
  const [value, setValue] = useState(String(initialSlots))
  const [saving, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Sync the input when server sends a new initial value (after another
  // edit elsewhere refreshed the page). React 19 sanctions setState
  // during render for "adjusting state when a prop changes" — track the
  // previous prop with useState rather than a ref or effect.
  const [prevInitial, setPrevInitial] = useState(initialSlots)
  if (prevInitial !== initialSlots) {
    setPrevInitial(initialSlots)
    setValue(String(initialSlots))
  }

  const dirty = Number(value) !== initialSlots
  const numeric = Number(value)
  const valid = Number.isInteger(numeric) && numeric >= 0 && numeric <= 50

  const save = () => {
    if (!valid) {
      setError('Must be a whole number between 0 and 50')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await setChapterSponsorSlots(chapterId, numeric)
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          max={50}
          value={value}
          onChange={e => setValue(e.target.value)}
          disabled={saving}
          className="h-8 w-16 text-sm"
          aria-label={`Sponsor slots for ${chapterName}`}
        />
        {dirty && (
          <Button
            size="sm"
            variant="outline"
            onClick={save}
            disabled={saving || !valid}
            className="h-8 px-2 gap-1"
          >
            {saving ? '…' : <><Check className="h-3.5 w-3.5" /> Save</>}
          </Button>
        )}
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  )
}

function AssignManagerDialog({
  chapterId, chapterName, existingMemberIds, open, onOpenChange,
}: {
  chapterId: number
  chapterName: string
  existingMemberIds: string[]
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChapterMemberSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state on close via the open-change callback rather than an
  // effect, so reopening doesn't surface stale results from a previous
  // chapter's search.
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setQuery('')
      setResults([])
      setError(null)
    }
    onOpenChange(v)
  }

  // Debounced typeahead. setState lands inside an async timeout callback
  // (not synchronously during the effect body), so the no-setState-in-
  // effect lint rule is satisfied. Short queries skip the fetch and
  // implicitly leave the previous results in place — they'll be
  // overwritten on the next valid search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) return
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const res = await searchMembersForChapter(query)
      setSearching(false)
      if (res.error) {
        setError(res.error)
        setResults([])
        return
      }
      setError(null)
      setResults(res.results)
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const assign = (memberId: string) => {
    startTransition(async () => {
      const res = await assignChapterManager(chapterId, memberId)
      if (res.error) {
        setError(res.error)
        return
      }
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign manager to {chapterName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Search for the member to assign. They keep their existing member role and gain Chapter Manager
            powers for {chapterName} only.
          </p>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or membership email…"
              className="pl-9"
              disabled={submitting}
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {query.trim().length < 2 ? (
              <p className="text-xs text-muted-foreground text-center py-6">Type at least 2 characters.</p>
            ) : searching ? (
              <p className="text-xs text-muted-foreground text-center py-6">Searching…</p>
            ) : results.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No matches.</p>
            ) : (
              results.map(r => {
                const already = existingMemberIds.includes(r.id)
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => !already && assign(r.id)}
                    disabled={already || submitting}
                    className={cn(
                      'w-full flex items-center gap-3 p-2 text-left',
                      already ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/40'
                    )}
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={r.avatar_url ?? undefined} />
                      <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                        {(r.full_name ?? '?').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.full_name ?? '—'}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {[r.eo_membership_email, r.eo_chapter].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    {already && <span className="text-[10px] text-muted-foreground">Already a manager</span>}
                  </button>
                )
              })
            )}
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
