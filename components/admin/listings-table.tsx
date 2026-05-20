'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { setBusinessStatusAdmin } from '@/actions/admin'
import { AdminDeleteListingButton } from '@/components/admin/delete-listing-button'
import { TransferListingButton } from '@/components/admin/transfer-listing-button'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Status = 'draft' | 'published' | 'paused'

const MEMBERSHIP_LABEL: Record<string, string> = {
  current_member: 'Current',
  alumni: 'Alumni',
  accelerator: 'Accelerator',
}

export interface AdminListing {
  id: string
  name: string
  owner_id: string
  status: Status
  city: string | null
  country: string | null
  created_at: string
  profiles: {
    full_name: string | null
    avatar_url: string | null
    eo_chapter: string | null
    eo_membership_type: string | null
    eo_membership_email: string | null
  } | null
}

const STATUS_COLORS: Record<Status, string> = {
  published: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  draft: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  paused: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
}

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
type PageSize = typeof PAGE_SIZE_OPTIONS[number]

export function ListingsTable({ listings, isSuperAdmin = false }: { listings: AdminListing[]; isSuperAdmin?: boolean }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(50)

  const filtered = listings.filter(l => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        l.name.toLowerCase().includes(q) ||
        l.profiles?.full_name?.toLowerCase().includes(q) ||
        l.profiles?.eo_chapter?.toLowerCase().includes(q) ||
        l.profiles?.eo_membership_email?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize)

  const handleSearch = (q: string) => { setSearch(q); setPage(0) }
  const handleStatus = (s: typeof statusFilter) => { setStatusFilter(s); setPage(0) }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
        <input
          placeholder="Search by name, owner, chapter…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="flex-1 h-9 px-3 rounded-lg bg-background border border-border text-sm"
        />
        <div className="flex gap-1">
          {(['all', 'published', 'draft', 'paused'] as const).map(s => (
            <button key={s} onClick={() => handleStatus(s)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium capitalize',
                statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}>
              {s === 'all' ? `all (${listings.length})` : `${s} (${listings.filter(l => l.status === s).length})`}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left p-3 font-medium">Business</th>
              <th className="text-left p-3 font-medium">Owner</th>
              <th className="text-left p-3 font-medium">Location</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium">Created</th>
              <th className="text-right p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(l => <ListingRow key={l.id} listing={l} isSuperAdmin={isSuperAdmin} />)}
            {paginated.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-muted-foreground text-sm">No listings match your filter.</td></tr>
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

function ListingRow({ listing, isSuperAdmin }: { listing: AdminListing; isSuperAdmin: boolean }) {
  const [isPending, startTransition] = useTransition()
  const setStatus = (status: Status) =>
    startTransition(() => { setBusinessStatusAdmin(listing.id, status) })

  const owner = listing.profiles

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/20">
      <td className="p-3">
        <Link href={`/marketplace/${listing.id}`} className="font-medium hover:text-primary">
          {listing.name}
        </Link>
      </td>
      <td className="p-3">
        {owner ? (
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-7 w-7 flex-shrink-0">
              <AvatarImage src={owner.avatar_url ?? undefined} />
              <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                {(owner.full_name ?? '?').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm truncate" title={owner.eo_membership_email ?? undefined}>{owner.full_name ?? '—'}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {owner.eo_membership_type && (
                  <span className="text-primary">{MEMBERSHIP_LABEL[owner.eo_membership_type] ?? owner.eo_membership_type}</span>
                )}
                {owner.eo_membership_type && owner.eo_chapter && ' · '}
                {owner.eo_chapter}
              </p>
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-3 text-muted-foreground">
        {[listing.city, listing.country].filter(Boolean).join(', ') || '—'}
      </td>
      <td className="p-3">
        <Badge className={cn('border', STATUS_COLORS[listing.status])}>{listing.status}</Badge>
      </td>
      <td className="p-3 text-muted-foreground text-xs">
        {format(new Date(listing.created_at), 'MMM d, yyyy')}
      </td>
      <td className="p-3 text-right">
        <div className="flex justify-end gap-1 flex-wrap">
          <Link
            href={`/admin/listings/${listing.id}/edit`}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            Edit
          </Link>
          <Link
            href={`/admin/listings/${listing.id}/services`}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            Services
          </Link>
          {listing.status !== 'published' && (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => setStatus('published')}>
              Publish
            </Button>
          )}
          {listing.status !== 'paused' && (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => setStatus('paused')}
              className="text-destructive hover:text-destructive">
              Pause
            </Button>
          )}
          {isSuperAdmin && (
            <TransferListingButton
              businessId={listing.id}
              businessName={listing.name}
              currentOwnerName={owner?.full_name ?? null}
            />
          )}
          <AdminDeleteListingButton businessId={listing.id} businessName={listing.name} />
        </div>
      </td>
    </tr>
  )
}
