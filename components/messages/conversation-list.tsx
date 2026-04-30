'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Building2, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const MEMBERSHIP_LABEL: Record<string, string> = {
  current_member: 'Current',
  alumni: 'Alumni',
  accelerator: 'Accelerator',
}

export interface ConversationListItem {
  id: string
  otherName: string
  otherAvatar: string | null
  otherChapter: string | null
  otherMembershipType: 'current_member' | 'alumni' | 'accelerator' | null
  /** Business id for the linked listing — null when the listing was
   *  deleted (listing_id IS NULL on the conversation row). */
  businessId: string | null
  businessName: string | null
  businessLogo: string | null
  /** True when the conversation has a listing_id but the business row
   *  no longer exists (cascade-set NULL on delete). UI shows "Deleted
   *  listing" placeholder instead of crashing on a missing name. */
  businessDeleted: boolean
  /** Title of the service the inquiry was originally about, when known. */
  serviceTitle: string | null
  /** Whether the current user is the seller (listing owner) or the
   *  buyer (inquirer) in this thread. Null for deleted-listing threads
   *  where we can't determine the role. */
  role: 'buyer' | 'seller' | null
  lastMessageBody: string | null
  lastMessageAt: string
  unread: boolean
}

export function ConversationList({
  conversations,
  activeId,
}: {
  conversations: ConversationListItem[]
  activeId: string | null
}) {
  const router = useRouter()
  // Throttle router.refresh() — realtime can fire several inserts in
  // quick succession (e.g. someone pasting a few quick replies) and
  // each refresh is a full RSC round-trip. 1500ms is fast enough that
  // a new conversation appears within a couple seconds, slow enough
  // that a flurry of inserts doesn't hammer the server.
  const lastRefreshRef = useRef(0)

  useEffect(() => {
    const supabase = createClient()
    // We rely on the messages-select RLS policy to filter the broadcast
    // to only conversations the current user participates in. The
    // server-rendered conversation list above is already scoped that
    // way; this realtime channel just mirrors the same access pattern.
    const channel = supabase
      .channel('inbox-refresh')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => {
          const now = Date.now()
          if (now - lastRefreshRef.current < 1500) return
          lastRefreshRef.current = now
          router.refresh()
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [router])

  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No conversations yet.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {conversations.map(c => (
        <ConversationRow key={c.id} conv={c} active={activeId === c.id} />
      ))}
    </div>
  )
}

function ConversationRow({ conv, active }: { conv: ConversationListItem; active: boolean }) {
  // The business label is the primary affordance for opening the
  // listing. Wrapping the whole row in <Link> would steal that click
  // for the conversation route — so the row itself is a Link, and the
  // business pill stops propagation and target=_blank into the listing.
  const businessHref = conv.businessId ? `/marketplace/${conv.businessId}` : null

  return (
    <Link
      href={`/dashboard/messages?conversation=${conv.id}`}
      className={cn(
        'flex gap-3 p-4 border-b border-border hover:bg-muted/50 transition-colors',
        active && 'bg-muted'
      )}
    >
      {/* Business logo (fallback to person initial when listing was
          deleted or the business never had a logo). */}
      <Avatar className="h-10 w-10 flex-shrink-0">
        <AvatarImage src={conv.businessLogo ?? conv.otherAvatar ?? undefined} />
        <AvatarFallback className="bg-primary/15 text-primary text-sm font-bold">
          {conv.businessDeleted
            ? <Building2 className="h-4 w-4" />
            : (conv.businessName?.charAt(0).toUpperCase()
                ?? conv.otherName.charAt(0).toUpperCase())}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        {/* Line 1: business name (clickable into the listing) +
            timestamp. The role pill takes line 1's right slot when
            there's space. */}
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {businessHref ? (
              <a
                href={businessHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className={cn(
                  'text-sm truncate hover:underline inline-flex items-center gap-1',
                  conv.unread ? 'font-bold' : 'font-semibold'
                )}
                title={`Open ${conv.businessName} listing`}
              >
                <span className="truncate">{conv.businessName}</span>
                <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              </a>
            ) : (
              <span className={cn(
                'text-sm truncate',
                conv.businessDeleted ? 'italic text-muted-foreground' : 'font-semibold'
              )}>
                {conv.businessDeleted ? 'Deleted listing' : (conv.businessName ?? conv.otherName)}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: false })}
          </span>
        </div>

        {/* Line 2: role pill + service. Both optional. */}
        {(conv.role || conv.serviceTitle) && (
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {conv.role && <RolePill role={conv.role} />}
            {conv.serviceTitle && (
              <span className="text-xs text-muted-foreground truncate">
                Re: <span className="text-foreground/80">{conv.serviceTitle}</span>
              </span>
            )}
          </div>
        )}

        {/* Line 3: member context — name · chapter · membership type. */}
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {[
            conv.otherName,
            conv.otherChapter,
            conv.otherMembershipType ? MEMBERSHIP_LABEL[conv.otherMembershipType] : null,
          ].filter(Boolean).join(' · ')}
        </p>

        {/* Line 4: last-message preview when present. Truncated. */}
        {conv.lastMessageBody && (
          <p className={cn(
            'text-xs truncate mt-0.5',
            conv.unread ? 'text-foreground font-medium' : 'text-muted-foreground'
          )}>
            {conv.lastMessageBody}
          </p>
        )}
      </div>

      {conv.unread && <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-2" />}
    </Link>
  )
}

function RolePill({ role }: { role: 'buyer' | 'seller' }) {
  return role === 'buyer' ? (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary text-primary-foreground">
      You inquired
    </span>
  ) : (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground">
      They inquired
    </span>
  )
}
