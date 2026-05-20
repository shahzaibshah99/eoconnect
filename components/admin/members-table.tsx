'use client'

import { useState, useTransition } from 'react'
import { setMemberStatus, setMemberRole, setChapterAdminScope } from '@/actions/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { ChapterPicker, type Chapter } from '@/components/forms/chapter-picker'
import { describeChapterScope } from '@/lib/chapter-scope'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

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
}

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
type PageSize = typeof PAGE_SIZE_OPTIONS[number]

export function MembersTable({ members, canChangeRole, chapters }: MembersTableProps) {
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(50)

  const nonArchived = members.filter(m => m.status !== 'archived')
  const archived = members.filter(m => m.status === 'archived')

  const base = filter === 'archived' ? archived : nonArchived
  const filtered = base.filter(m => {
    if (filter !== 'all' && filter !== 'archived' && m.status !== filter) return false
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

  const handleSearch = (q: string) => {
    setSearch(q)
    setPage(0)
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
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
              <MemberRow key={m.id} member={m} canChangeRole={canChangeRole} chapters={chapters} />
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

function MemberRow({ member, canChangeRole, chapters }: { member: Member; canChangeRole: boolean; chapters: Chapter[] }) {
  const [isPending, startTransition] = useTransition()
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false)

  const changeStatus = (status: Status) =>
    startTransition(() => { setMemberStatus(member.id, status) })

  const changeRole = (role: Role) => {
    if (role === 'chapter_admin') {
      setScopeDialogOpen(true)
      startTransition(() => { setMemberRole(member.id, role) })
      return
    }
    startTransition(() => { setMemberRole(member.id, role) })
  }

  const isArchived = member.status === 'archived'

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
          <div className="flex items-center justify-end gap-1">
            {isArchived ? (
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => changeStatus('suspended')}>
                Unarchive
              </Button>
            ) : (
              <>
                {member.status !== 'active' && (
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => changeStatus('active')}>
                    Approve
                  </Button>
                )}
                {member.status !== 'suspended' && (
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => changeStatus('suspended')}
                    className="text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive">
                    Suspend
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => changeStatus('archived')}
                  className="text-muted-foreground hover:text-foreground">
                  Archive
                </Button>
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
    </>
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
