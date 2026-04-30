'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { setBusinessStatusAdmin } from '@/actions/admin'
import { AdminDeleteListingButton } from '@/components/admin/delete-listing-button'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

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

export function ListingsTable({ listings }: { listings: AdminListing[] }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
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
            {listings.map(l => <ListingRow key={l.id} listing={l} />)}
            {listings.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-muted-foreground text-sm">No listings.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ListingRow({ listing }: { listing: AdminListing }) {
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
          <AdminDeleteListingButton businessId={listing.id} businessName={listing.name} />
        </div>
      </td>
    </tr>
  )
}
