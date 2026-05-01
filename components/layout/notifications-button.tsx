'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Bell, Star } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { markNotificationsRead } from '@/actions/notifications'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

export interface NotificationItem {
  id: string
  rating: number
  body: string | null
  business_id: string
  business_name: string
  reviewer_name: string
  created_at: string
}

interface NotificationsButtonProps {
  unread: number
  recent: NotificationItem[]
  /** Business ids the current user owns. The realtime subscription
   *  listens to ALL review inserts (RLS won't let us filter at the
   *  postgres_changes level by JOIN), then this list is used as a
   *  client-side filter — only inserts targeting one of the user's
   *  own businesses bump the count. Empty array disables the
   *  subscription entirely. */
  ownedBusinessIds: string[]
}

/**
 * Bell icon in the navbar that surfaces in-app notifications.
 *
 * Currently scopes notifications to NEW REVIEWS on the user's own
 * listings (the user's main ask). The dropdown shows the last 5
 * reviews and the unread badge counts those created after the
 * profile's notifications_seen_at column.
 *
 * Opening the dropdown calls markNotificationsRead, which bumps
 * notifications_seen_at to now() server-side and busts the layout
 * cache so the badge clears on the next render. We don't try to
 * be clever about "unread vs read" inside the dropdown — once you
 * open it, everything's marked read.
 *
 * Future scope: wire other event types (new messages, new
 * inquiries, ad approvals) into the same bell so the user has a
 * single hub. Today messages have their own badge on the nav link
 * and stay independent.
 */
export function NotificationsButton({ unread, recent, ownedBusinessIds }: NotificationsButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Local count overlay on top of the server-rendered `unread`. The
  // server count is what the page shipped with on this render; the
  // local count adds any review INSERTs that happened after the page
  // loaded but before the user has seen them. Bell badge displays
  // the sum.
  const [liveBumps, setLiveBumps] = useState(0)
  const totalUnread = unread + liveBumps

  // Keep ownedBusinessIds in a ref so the realtime handler can
  // read the current list without re-subscribing whenever the
  // server re-renders. (router.refresh() updates props; we don't
  // want that to tear down the realtime channel mid-flight.)
  const ownedBusinessIdsRef = useRef<Set<string>>(new Set(ownedBusinessIds))
  useEffect(() => {
    ownedBusinessIdsRef.current = new Set(ownedBusinessIds)
  }, [ownedBusinessIds])

  // Subscribe to review INSERTs across the whole table. RLS lets
  // anyone read reviews on their own businesses (and others'); the
  // payload is filtered client-side against ownedBusinessIdsRef
  // so we only bump for reviews on the user's listings, and we
  // skip self-reviews defensively even though they shouldn't be
  // possible (an admin could review their own business via service
  // role, etc.).
  useEffect(() => {
    if (ownedBusinessIds.length === 0) return
    const supabase = createClient()
    const channel = supabase
      .channel('notifications-bell')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reviews' },
        (payload) => {
          const r = payload.new as { business_id?: string } | null
          if (!r || typeof r.business_id !== 'string') return
          if (!ownedBusinessIdsRef.current.has(r.business_id)) return
          setLiveBumps(c => c + 1)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // Intentionally only watching ownedBusinessIds.length — we
    // re-subscribe only when the user gains/loses business ownership,
    // which is rare. Identity changes within the array don't need a
    // new subscription because the ref above tracks the live set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedBusinessIds.length])

  const handleOpen = (open: boolean) => {
    // Only fire on open; closing shouldn't re-stamp.
    if (open && totalUnread > 0) {
      // Clear the live overlay immediately so the badge disappears
      // as soon as the dropdown opens, even if router.refresh has
      // a few hundred ms of latency.
      setLiveBumps(0)
      startTransition(async () => {
        const result = await markNotificationsRead()
        if (!result.error) {
          // refresh() forces the layout to re-render the count from
          // the new notifications_seen_at value. Without it the
          // server-side `unread` would still hold its old value
          // until the next navigation.
          router.refresh()
        }
      })
    }
  }

  return (
    <DropdownMenu onOpenChange={handleOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={totalUnread > 0 ? `${totalUnread} new notifications` : 'Notifications'}
            title="Notifications"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="h-[18px] w-[18px]" />
            {totalUnread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-primary text-primary-foreground">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <p className="font-semibold text-sm">Notifications</p>
          {recent.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {isPending ? 'Marking…' : 'Last 5'}
            </span>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            No reviews yet.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {recent.map(n => (
              <DropdownMenuItem
                key={n.id}
                className="cursor-pointer flex-col items-start gap-1 px-3 py-2.5 rounded-none"
                onClick={() => router.push(`/marketplace/${n.business_id}#reviews`)}
              >
                <div className="flex items-center justify-between w-full gap-2">
                  <p className="text-sm font-medium truncate">{n.reviewer_name}</p>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: false })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground w-full">
                  <span className="truncate">reviewed {n.business_name}</span>
                  <span className="inline-flex items-center gap-0.5 flex-shrink-0">
                    <Star className={cn('h-3 w-3', n.rating > 0 ? 'fill-primary text-primary' : 'text-muted-foreground')} />
                    <span>{n.rating}</span>
                  </span>
                </div>
                {n.body && (
                  <p className="text-xs text-muted-foreground line-clamp-2 w-full">
                    &ldquo;{n.body}&rdquo;
                  </p>
                )}
              </DropdownMenuItem>
            ))}
          </div>
        )}
        <div className="border-t border-border p-2">
          <Link
            href="/dashboard/business/edit"
            className="block w-full text-center text-xs text-muted-foreground hover:text-foreground py-1"
          >
            Manage your listings →
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
