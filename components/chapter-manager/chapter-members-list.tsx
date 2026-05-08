'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { endorseChapterMember, removeChapterEndorsement } from '@/actions/chapter-manager'
import {
  VERIFICATION_TAG_LABEL,
  type VerificationTag,
} from '@/lib/verification-tags'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { format } from 'date-fns'
import { BadgeCheck, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ChapterMember {
  id: string
  full_name: string | null
  avatar_url: string | null
  eo_membership_email: string | null
  verification_tag: string
  created_at: string
  endorsement: { id: string; note: string | null } | null
}

export function ChapterMembersList({
  chapterId, members,
}: { chapterId: number; members: ChapterMember[] }) {
  const [filter, setFilter] = useState<'all' | 'unverified' | 'verified' | 'endorsed' | 'not-endorsed'>('all')
  const [search, setSearch] = useState('')

  const counts = useMemo(() => ({
    all: members.length,
    unverified: members.filter(m => m.verification_tag === 'unverified').length,
    verified: members.filter(m => m.verification_tag !== 'unverified').length,
    endorsed: members.filter(m => m.endorsement).length,
    'not-endorsed': members.filter(m => !m.endorsement).length,
  }), [members])

  const visible = members.filter(m => {
    if (filter === 'unverified' && m.verification_tag !== 'unverified') return false
    if (filter === 'verified' && m.verification_tag === 'unverified') return false
    if (filter === 'endorsed' && !m.endorsement) return false
    if (filter === 'not-endorsed' && m.endorsement) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        m.full_name?.toLowerCase().includes(q) ||
        m.eo_membership_email?.toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
        <input
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 h-9 px-3 rounded-lg bg-background border border-border text-sm"
        />
        <div className="flex gap-1 flex-wrap">
          {([
            ['all', 'All'],
            ['unverified', 'Unverified'],
            ['verified', 'Verified'],
            ['endorsed', 'Endorsed by you'],
            ['not-endorsed', 'Not endorsed'],
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
          No members match this filter.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map(m => <MemberRow key={m.id} chapterId={chapterId} member={m} />)}
        </ul>
      )}
    </div>
  )
}

function MemberRow({ chapterId, member }: { chapterId: number; member: ChapterMember }) {
  const router = useRouter()
  const [endorseOpen, setEndorseOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const remove = () => {
    if (!member.endorsement) return
    startTransition(async () => {
      const res = await removeChapterEndorsement(member.endorsement!.id, chapterId)
      if (!res.error) router.refresh()
    })
  }

  const tag = member.verification_tag as VerificationTag

  return (
    <li className="p-3 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-3">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={member.avatar_url ?? undefined} />
          <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
            {(member.full_name ?? '?').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{member.full_name ?? '—'}</p>
            {tag !== 'unverified' ? (
              <Badge variant="secondary" className="text-[10px]">
                {VERIFICATION_TAG_LABEL[tag] ?? tag}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">Unverified</Badge>
            )}
            {member.endorsement && (
              <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 border text-[10px] gap-1">
                <BadgeCheck className="h-3 w-3" /> Endorsed by you
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {member.eo_membership_email ?? '—'} · joined {format(new Date(member.created_at), 'MMM d, yyyy')}
          </p>
          {member.endorsement?.note && (
            <p className="text-[11px] text-muted-foreground mt-1 italic">
              Your note: &ldquo;{member.endorsement.note}&rdquo;
            </p>
          )}
        </div>

        <div className="flex gap-1 shrink-0">
          {member.endorsement ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" disabled={isPending}>
                  Remove
                </Button>
              }
              title="Remove your endorsement?"
              description={
                <>
                  Remove your &ldquo;in our chapter&rdquo; endorsement of{' '}
                  <strong className="text-foreground">{member.full_name}</strong>?
                </>
              }
              confirmLabel="Remove"
              onConfirm={async () => { await new Promise<void>(res => { remove(); res() }) }}
            />
          ) : (
            <Button size="sm" onClick={() => setEndorseOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Endorse
            </Button>
          )}
        </div>
      </div>

      <EndorseDialog
        chapterId={chapterId}
        member={member}
        open={endorseOpen}
        onOpenChange={setEndorseOpen}
      />
    </li>
  )
}

function EndorseDialog({
  chapterId, member, open, onOpenChange,
}: {
  chapterId: number
  member: ChapterMember
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
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
      const res = await endorseChapterMember({
        chapter_id: chapterId,
        member_id: member.id,
        note: note.trim() || undefined,
      })
      if (res.error) { setError(res.error); return }
      handleOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Endorse {member.full_name ?? 'this member'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Confirm this person is a member of your chapter. The admin reviewing their verification will see this as an additional trust signal.
          </p>
          <div className="space-y-2">
            <label className="text-xs font-medium block">Optional note</label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Joined our forum in 2023 — I&apos;ve hosted them at our chapter retreat twice."
              rows={3}
              maxLength={300}
              className="resize-none"
            />
            <p className="text-[11px] text-muted-foreground text-right">{note.length}/300</p>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? 'Endorsing…' : 'Confirm endorsement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
