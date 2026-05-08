'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  searchChapterCandidatesForEndorsement,
  endorseChapterMember,
  type ChapterMemberSearchResult,
} from '@/actions/chapter-manager'
import {
  VERIFICATION_TAG_LABEL,
  type VerificationTag,
} from '@/lib/verification-tags'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Search, Check, BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export function EndorsePicker({ chapterId }: { chapterId: number }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChapterMemberSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<ChapterMemberSearchResult | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) return
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const res = await searchChapterCandidatesForEndorsement(chapterId, query)
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
  }, [query, chapterId])

  const submit = () => {
    if (!picked) return
    setError(null)
    startTransition(async () => {
      const res = await endorseChapterMember({
        chapter_id: chapterId,
        member_id: picked.id,
        note: note.trim() || undefined,
      })
      if (res.error) { setError(res.error); return }
      // Reset and refresh the result list to reflect the new endorsement.
      setPicked(null)
      setNote('')
      setQuery(query) // re-trigger search so already_endorsed_by_me updates
      router.refresh()
    })
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="pl-9"
        />
      </div>

      {!picked ? (
        <div className="rounded-lg border border-border divide-y divide-border max-h-96 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Type at least 2 characters. Search is scoped to your chapter&apos;s country/city.
            </p>
          ) : searching ? (
            <p className="text-xs text-muted-foreground text-center py-8">Searching…</p>
          ) : results.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No matches in your chapter.
            </p>
          ) : (
            results.map(r => {
              const tag = r.verification_tag as VerificationTag
              const disabled = r.already_endorsed_by_me
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => !disabled && setPicked(r)}
                  disabled={disabled}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 text-left',
                    disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/40'
                  )}
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={r.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                      {(r.full_name ?? '?').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{r.full_name ?? '—'}</p>
                      {tag !== 'unverified' ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {VERIFICATION_TAG_LABEL[tag] ?? tag}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Unverified</Badge>
                      )}
                      {r.already_endorsed_by_me && (
                        <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 border text-[10px] gap-1">
                          <BadgeCheck className="h-3 w-3" /> Endorsed
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {r.eo_membership_email ?? '—'}
                    </p>
                  </div>
                </button>
              )
            })
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-muted/30 border border-border flex items-center gap-3">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={picked.avatar_url ?? undefined} />
              <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                {(picked.full_name ?? '?').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{picked.full_name ?? '—'}</p>
              <p className="text-[11px] text-muted-foreground truncate">{picked.eo_membership_email ?? '—'}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setPicked(null)} disabled={isPending}>
              Change
            </Button>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium block">Optional note</label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Context for the admin reviewing this member's verification…"
              rows={3}
              maxLength={300}
              className="resize-none"
            />
            <p className="text-[11px] text-muted-foreground text-right">{note.length}/300</p>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Button onClick={submit} disabled={isPending} className="gap-1.5">
            <Check className="h-3.5 w-3.5" />
            {isPending ? 'Endorsing…' : 'Confirm endorsement'}
          </Button>
        </div>
      )}
    </div>
  )
}
