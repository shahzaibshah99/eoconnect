'use client'

import { useState, useTransition } from 'react'
import { setMemberStatus, setMemberRole, setChapterAdminScope, manualVerifyMember } from '@/actions/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { ChapterPicker, type Chapter } from '@/components/forms/chapter-picker'
import { describeChapterScope } from '@/lib/chapter-scope'
import { ChevronLeft, ChevronRight, ShieldCheck, Ban, Archive, ArchiveRestore, UserCheck, CheckCircle, Tag } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { VERIFICATION_TAG_LABEL, type AssignableTag } from '@/lib/verification-tags'

type Status = 'pending' | 'active' | 'suspended' | 'archived'
type Role = 'member' | 'chapter_admin' | 'super_admin'

interface Member {
  id: string
  full_name: string
  eo_chapter: string | null
  role: Role
  status: Status
  created_at: string
  eo_membership_email: string | null
  admin_scope_country: string | null
  admin_scope_city: string | null
  avatar_url: string | null
  verification_tag: string
}

const STATUS_VARIANTS: Record<Status, string> = {
  active: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  suspended: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  archived: 'bg-muted text-muted-foreground border-border',
}

interface MembersTableProps {
  members: Member[]
  canChangeRole: boolean
  chapters: Chapter[]
  assignableTags: AssignableTag[]
}

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
type PageSize = typeof PAGE_SIZE_OPTIONS[number]

export function MembersTable({ members, canChangeRole, chapters, assignableTags }: MembersTableProps) {
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [tagFilter, setTagFilter] = useState<'all' | 'unverified' | AssignableTag>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(50)

  const nonArchived = members.filter(m => m.status !== 'archived')
  const archived = members.filter(m => m.status === 'archived')

  const base = filter === 'archived' ? archived : nonArchived
  const filtered = base.filter(m => {
    if (filter !== 'all' && filter !== 'archived' && m.status !== filter) return false
    if (tagFilter !== 'all') {
      const isUnverified = !m.verification_tag || m.verification_tag === 'unverified'
      if (tagFilter === 'unverified' && !isUnverified) return false
      if (tagFilter !== 'unverified' && m.verification_tag !== tagFilter) return false
    }
    if (search) {
      const q = search.toLowerCase()
      return m.full_name.toLowerCase().includes(q) || m.eo_chapter?.toLowerCase().includes(q) || m.eo_membership_email?.toLowerCase().includes(q)
    }
    return true
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize)

  const handleFilterChange = (f: typeof filter) => {
    setFilter(f)
    setPage(0)
  }

  const handleTagFilterChange = (f: typeof tagFilter) => {
    setTagFilter(f)
    setPage(0)
  }

  const handleSearch = (q: string) => {
    setSearch(q)
    setPage(0)
  }

  const unverifiedCount = nonArchived.filter(m => !m.verification_tag || m.verification_tag === 'unverified').length

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            placeholder="Search by name, email, chapter…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="flex-1 h-9 px-3 rounded-lg bg-background border border-border text-sm"
          />
          <div className="flex gap-1 flex-wrap">
            {(['all', 'pending', 'active', 'suspended', 'archived'] as const).map(s => (
              <button
                key={s}
                onClick={() => handleFilterChange(s)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium capitalize',
                  filter === s ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                )}
              >
                {s === 'all' ? `all (${nonArchived.length})` : s === 'archived' ? `archived (${archived.length})` : `${s} (${nonArchived.filter(m => m.status === s).length})`}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => handleTagFilterChange('all')}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium', tagFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}
          >
            All types
          </button>
          <button
            onClick={() => handleTagFilterChange('unverified')}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium', tagFilter === 'unverified' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}
          >
            Unverified ({unverifiedCount})
          </button>
          {assignableTags.map(t => (
            <button
              key={t}
              onClick={() => handleTagFilterChange(t)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium', tagFilter === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}
            >
              {VERIFICATION_TAG_LABEL[t]} ({nonArchived.filter(m => m.verification_tag === t).length})
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left p-3 font-medium">Name</th>
              <th className="text-left p-3 font-medium">Chapter</th>
              <th className="text-left p-3 font-medium">Role</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium">Joined</th>
              <th className="text-right p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(m => (
              <MemberRow key={m.id} member={m} canChangeRole={canChangeRole} chapters={chapters} assignableTags={assignableTags} />
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                  No members match your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > 0 && (
        <div className="p-3 border-t border-border flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Show</span>
            {PAGE_SIZE_OPTIONS.map(n => (
              <button key={n} onClick={() => { setPageSize(n); setPage(0) }}
                className={cn('px-2 py-0.5 rounded text-xs font-medium', pageSize === n ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}>
                {n}
              </button>
            ))}
          </div>
          <span className="text-xs">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="p-1 rounded hover:bg-muted disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-muted disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MemberRow({ member, canChangeRole, chapters, assignableTags }: { member: Member; canChangeRole: boolean; chapters: Chapter[]; assignableTags: AssignableTag[] }) {
  const [isPending, startTransition] = useTransition()
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false)
  const [cmWarningOpen, setCmWarningOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<Status | null>(null)

  const changeStatus = (status: Status, force = false) =>
    startTransition(async () => {
      const res = await setMemberStatus(member.id, status, force)
      if (res?.chapterManagerWarning) {
        setPendingStatus(status)
        setCmWarningOpen(true)
      }
    })

  const changeRole = (role: Role) => {
    if (role === 'chapter_admin') {
      setScopeDialogOpen(true)
      startTransition(() => { setMemberRole(member.id, role) })
      return
    }
    startTransition(() => { setMemberRole(member.id, role) })
  }

  const isArchived = member.status === 'archived'
  const isUnverified = !member.verification_tag || member.verification_tag === 'unverified'

  return (
    <>
      <tr className={cn('border-b border-border last:border-0 hover:bg-muted/20', isArchived && 'opacity-60')}>
        <td className="p-3">
          <div className="flex items-center gap-2.5">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={member.avatar_url ?? undefined} />
              <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                {(member.full_name ?? '?').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-medium">{member.full_name}</p>
              {member.eo_membership_email && (
                <p className="text-xs text-muted-foreground truncate">{member.eo_membership_email}</p>
              )}
              {!isUnverified && (
                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400 font-medium mt-0.5">
                  <CheckCircle className="h-2.5 w-2.5" />
                  {VERIFICATION_TAG_LABEL[member.verification_tag as AssignableTag] ?? member.verification_tag}
                </span>
              )}
            </div>
          </div>
        </td>
        <td className="p-3 text-muted-foreground">{member.eo_chapter ?? '—'}</td>
        <td className="p-3">
          {canChangeRole && !isArchived ? (
            <div className="flex flex-col gap-1">
              <Select value={member.role} onValueChange={(v: string | null) => v && changeRole(v as Role)}>
                <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="chapter_admin">Chapter Admin</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
              {member.role === 'chapter_admin' && (
                <button
                  type="button"
                  onClick={() => setScopeDialogOpen(true)}
                  className="text-[11px] text-left text-muted-foreground hover:text-foreground hover:underline"
                >
                  Scope: {describeChapterScope({ country: member.admin_scope_country, city: member.admin_scope_city })}
                </button>
              )}
            </div>
          ) : (
            <span className="capitalize text-xs">{member.role.replace('_', ' ')}</span>
          )}
        </td>
        <td className="p-3">
          <Badge className={cn('border', STATUS_VARIANTS[member.status])}>{member.status}</Badge>
        </td>
        <td className="p-3 text-muted-foreground text-xs">
          {format(new Date(member.created_at), 'MMM d, yyyy')}
        </td>
        <td className="p-3">
          <div className="flex items-center justify-end gap-0.5">
            {!isArchived && canChangeRole && (
              <VerifyMemberDialog member={member} assignableTags={assignableTags} isVerified={!isUnverified} />
            )}
            {isArchived ? (
              <button
                title="Unarchive"
                disabled={isPending}
                onClick={() => changeStatus('suspended')}
                className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
              </button>
            ) : (
              <>
                {member.status !== 'active' && (
                  <button
                    title="Approve"
                    disabled={isPending}
                    onClick={() => changeStatus('active')}
                    className="h-7 w-7 rounded-md flex items-center justify-center text-green-600 dark:text-green-400 hover:bg-green-500/10 disabled:opacity-30 transition-colors"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                  </button>
                )}
                {member.status !== 'suspended' && (
                  <button
                    title="Suspend"
                    disabled={isPending}
                    onClick={() => changeStatus('suspended')}
                    className="h-7 w-7 rounded-md flex items-center justify-center text-destructive hover:bg-destructive/10 disabled:opacity-30 transition-colors"
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  title="Archive"
                  disabled={isPending}
                  onClick={() => changeStatus('archived')}
                  className="h-7 w-7 rounded-md flex items-center justify-center text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 disabled:opacity-30 transition-colors"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
      <ScopeDialog
        open={scopeDialogOpen}
        onOpenChange={setScopeDialogOpen}
        member={member}
        chapters={chapters}
      />
      <Dialog open={cmWarningOpen} onOpenChange={setCmWarningOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>This member is a chapter manager</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1 text-sm text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">{member.full_name}</span> is assigned as a chapter manager.
              {pendingStatus === 'suspended' ? ' Suspending' : ' Archiving'} their account will lock them out of the platform,
              but will <span className="font-semibold text-foreground">not</span> remove them from chapter management assignments.
            </p>
            <p>You may want to reassign the chapter first. Proceed anyway?</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCmWarningOpen(false); setPendingStatus(null) }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setCmWarningOpen(false)
                if (pendingStatus) changeStatus(pendingStatus, true)
                setPendingStatus(null)
              }}
            >
              {pendingStatus === 'suspended' ? 'Suspend anyway' : 'Archive anyway'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function VerifyMemberDialog({ member, assignableTags, isVerified }: { member: Member; assignableTags: AssignableTag[]; isVerified: boolean }) {
  const [open, setOpen] = useState(false)
  const currentTag = assignableTags.includes(member.verification_tag as AssignableTag)
    ? (member.verification_tag as AssignableTag)
    : assignableTags[0]
  const [tag, setTag] = useState<AssignableTag>(currentTag)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    setError(null)
    startTransition(async () => {
      const res = await manualVerifyMember(member.id, tag)
      if (res.error) setError(res.error)
      else setOpen(false)
    })
  }

  if (assignableTags.length === 0) return null

  const title = isVerified ? `Change tag for ${member.full_name}` : `Manually verify ${member.full_name}`
  const buttonLabel = isPending ? (isVerified ? 'Saving…' : 'Verifying…') : (isVerified ? 'Update tag' : 'Verify member')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button
        title={isVerified ? 'Change tag' : 'Verify member'}
        className={cn(
          'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
          isVerified
            ? 'text-blue-600 dark:text-blue-400 hover:bg-blue-500/10'
            : 'text-green-600 dark:text-green-400 hover:bg-green-500/10'
        )}
      />}>
        {isVerified ? <Tag className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            {isVerified
              ? 'Change the verification tag assigned to this member.'
              : 'Bypasses the normal verification form. Use for known members you can vouch for directly.'}
          </p>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">
              {isVerified ? 'Change to' : 'Assign tag'}
            </label>
            <Select value={tag} onValueChange={(v: string | null) => v && setTag(v as AssignableTag)}>
              <SelectTrigger className="w-full h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {assignableTags.map(t => (
                  <SelectItem key={t} value={t}>{VERIFICATION_TAG_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={save} disabled={isPending}>{buttonLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScopeDialog({
  open, onOpenChange, member, chapters,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  member: Member
  chapters: Chapter[]
}) {
  const [isPending, startTransition] = useTransition()
  const initial = chapters.find(c =>
    c.country === member.admin_scope_country &&
    (c.city ?? null) === (member.admin_scope_city ?? null)
  ) ?? null
  const [chapter, setChapter] = useState<Chapter | null>(initial)
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    setError(null)
    if (!chapter) {
      setError('Pick a chapter to scope this admin to')
      return
    }
    if (!chapter.country) {
      setError('This chapter has no country — pick a country-based chapter')
      return
    }
    startTransition(async () => {
      const res = await setChapterAdminScope(member.id, {
        country: chapter.country,
        city: chapter.city,
      })
      if (res.error) setError(res.error)
      else onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Set admin scope for {member.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Pick the EO chapter this admin will manage. Members and businesses in that chapter
            (matched by country, plus city for city-level chapters) become moderatable.
          </p>
          <ChapterPicker
            chapters={chapters.filter(c => c.country !== null)}
            value={chapter?.name ?? null}
            onChange={setChapter}
            placeholder="Select chapter to administer…"
          />
          {chapter && (
            <p className="text-xs text-muted-foreground">
              Will manage: <span className="text-foreground">{describeChapterScope({ country: chapter.country, city: chapter.city })}</span>
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={save} disabled={isPending || !chapter}>
            {isPending ? 'Saving…' : 'Save scope'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
