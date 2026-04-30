'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { searchMembersForTransfer, transferBusinessOwnership, type MemberSearchResult } from '@/actions/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Search, ArrowRightLeft, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  businessId: string
  businessName: string
  currentOwnerName: string | null
}

/**
 * Admin-only transfer dialog. Two-step flow:
 *   1. Search/pick the target member (typeahead, server-action backed)
 *   2. Confirm the transfer summary (current → new) before submitting
 *
 * Conversations are deliberately NOT re-routed — past message history
 * stays attributed to the previous owner. New inquiries land in the new
 * owner's inbox automatically because the listing now points at them.
 */
export function TransferListingButton({ businessId, businessName, currentOwnerName }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemberSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<MemberSearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced typeahead. 250ms feels responsive without hammering the
  // server on every keystroke.
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchMembersForTransfer(query)
        if (res.error) setError(res.error)
        setResults(res.results)
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, open])

  const reset = () => {
    setQuery('')
    setResults([])
    setPicked(null)
    setError(null)
  }

  const onConfirm = () => {
    setError(null)
    if (!picked) {
      setError('Pick a member to transfer to')
      return
    }
    startTransition(async () => {
      const result = await transferBusinessOwnership(businessId, picked.id)
      if (result.error) {
        setError(result.error)
        return
      }
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger
        render={
          <Button type="button" size="sm" variant="outline" />
        }
      >
        <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
        Transfer
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer &ldquo;{businessName}&rdquo;</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            Currently owned by <span className="text-foreground font-medium">{currentOwnerName ?? 'unknown'}</span>.
            New owner will see this listing on their dashboard and receive any new inquiries.
            Past conversations stay with the previous owner.
          </p>

          {!picked ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="member-search">Search for a member</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="member-search"
                    autoFocus
                    placeholder="Name or email…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="max-h-[40vh] overflow-y-auto border border-border rounded-lg">
                {searching && (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">Searching…</div>
                )}
                {!searching && query.trim().length < 2 && (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                    Type at least 2 characters to search
                  </div>
                )}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No members match &ldquo;{query}&rdquo;
                  </div>
                )}
                {!searching && results.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPicked(m)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 hover:bg-muted transition-colors flex items-center gap-2.5 border-b border-border last:border-0',
                    )}
                  >
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarImage src={m.avatar_url ?? undefined} />
                      <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                        {(m.full_name ?? '?').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{m.full_name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {m.eo_membership_email ?? 'no email'}
                        {m.eo_chapter && ` · ${m.eo_chapter}`}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <Label className="text-xs">Transferring to</Label>
              <div className="flex items-center gap-3 p-3 border border-primary/30 rounded-lg bg-primary/5">
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarImage src={picked.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-primary/15 text-primary text-sm font-bold">
                    {(picked.full_name ?? '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{picked.full_name ?? '—'}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {picked.eo_membership_email ?? 'no email'}
                    {picked.eo_chapter && ` · ${picked.eo_chapter}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  disabled={isPending}
                >
                  Change
                </button>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!picked || isPending}
          >
            {isPending ? 'Transferring…' : (
              <>
                <Check className="h-4 w-4 mr-1.5" />
                Transfer ownership
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
