'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Bell, Star } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { markNotificationsRead } from '@/actions/notifications'
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
export function NotificationsButton({ unread, recent }: NotificationsButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleOpen = (open: boolean) => {
    // Only fire on open; closing shouldn't re-stamp.
    if (open && unread > 0) {
      startTransition(async () => {
        const result = await markNotificationsRead()
        if (!result.error) {
          // refresh() forces the layout to re-render the count from
          // the new notifications_seen_at value. Without it the
          // badge would stay until next navigation.
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
            aria-label={unread > 0 ? `${unread} new notifications` : 'Notifications'}
            title="Notifications"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="h-[18px] w-[18px]" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-primary text-primary-foreground">
                {unread > 99 ? '99+' : unread}
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
