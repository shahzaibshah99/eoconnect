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
  /** Buyer = current user inquired on someone else's listing.
   *  Seller = someone inquired on the current user's listing.
   *  Null = orphaned (listing deleted, role unknown). */
  role: 'buyer' | 'seller' | null

  // The OTHER person in the conversation.
  otherName: string
  otherAvatar: string | null
  otherChapter: string | null
  otherMembershipType: 'current_member' | 'alumni' | 'accelerator' | null

  // The listing this conversation is about.
  // Buyer-side: this is the row primary.
  // Seller-side: this is the "About: X" tag.
  listingBusinessId: string | null
  listingBusinessName: string | null
  listingBusinessLogo: string | null
  /** True iff the conversation has a listing_id but the business row
   *  is gone. Row falls back to the orphaned-thread treatment. */
  listingDeleted: boolean

  // The INQUIRER's representative business. Populated only for
  // seller-side rows so we can show their business as the row primary
  // (instead of the seller's own business, which is redundant info).
  inquirerBusinessId: string | null
  inquirerBusinessName: string | null
  inquirerBusinessLogo: string | null

  serviceTitle: string | null
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
  const lastRefreshRef = useRef(0)

  useEffect(() => {
    const supabase = createClient()
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

/**
 * One conversation row. Renders asymmetrically based on role:
 *
 *   Buyer-side (current user sent the inquiry):
 *     primary  = listing's business (linked → listing)
 *     about    = nothing (the listing IS the row primary)
 *     subtitle = otherName · chapter · membership
 *
 *   Seller-side (someone inquired on current user's listing):
 *     primary  = inquirer's own business (linked → their listing)
 *                or their profile name if they don't have a business
 *     about    = "About: <my listing>" + "Re: <my service>"
 *     subtitle = inquirer's name · chapter · membership
 *
 *   Deleted listing / orphaned (role === null):
 *     primary  = "Deleted listing" (italic, no link)
 *     subtitle = otherName · chapter · membership
 */
function ConversationRow({ conv, active }: { conv: ConversationListItem; active: boolean }) {
  // Resolve "what's the row primary?" based on role.
  const isSeller = conv.role === 'seller'
  const isBuyer = conv.role === 'buyer'
  const isOrphan = conv.role === null

  // Primary identity = the OTHER side of the conversation. For seller,
  // that's the inquirer's business (or profile fallback). For buyer,
  // that's the listing they're asking about.
  const primaryName = isSeller
    ? (conv.inquirerBusinessName ?? conv.otherName)
    : (conv.listingBusinessName ?? conv.otherName)
  const primaryLogo = isSeller
    ? (conv.inquirerBusinessLogo ?? conv.otherAvatar)
    : (conv.listingBusinessLogo ?? conv.otherAvatar)
  const primaryHref = isSeller
    ? (conv.inquirerBusinessId ? `/marketplace/${conv.inquirerBusinessId}` : null)
    : (conv.listingBusinessId ? `/marketplace/${conv.listingBusinessId}` : null)

  return (
    <Link
      href={`/dashboard/messages?conversation=${conv.id}`}
      className={cn(
        'flex gap-3 p-4 border-b border-border hover:bg-muted/50 transition-colors',
        active && 'bg-muted'
      )}
    >
      <Avatar className="h-10 w-10 flex-shrink-0">
        <AvatarImage src={primaryLogo ?? undefined} />
        <AvatarFallback className="bg-primary/15 text-primary text-sm font-bold">
          {isOrphan
            ? <Building2 className="h-4 w-4" />
            : primaryName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        {/* Line 1: primary identity (linked to listing if available)
            and timestamp on the right. */}
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {isOrphan || conv.listingDeleted ? (
              <span className="text-sm truncate italic text-muted-foreground">
                {conv.listingDeleted ? 'Deleted listing' : primaryName}
              </span>
            ) : primaryHref ? (
              <a
                href={primaryHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className={cn(
                  'text-sm truncate hover:underline inline-flex items-center gap-1',
                  conv.unread ? 'font-bold' : 'font-semibold'
                )}
                title={`Open ${primaryName}`}
              >
                <span className="truncate">{primaryName}</span>
                <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              </a>
            ) : (
              <span className={cn('text-sm truncate', conv.unread ? 'font-bold' : 'font-semibold')}>
                {primaryName}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: false })}
          </span>
        </div>

        {/* Line 2: role pill — same for buyer/seller. */}
        {(isBuyer || isSeller) && (
          <div className="mt-1">
            <RolePill role={conv.role!} />
          </div>
        )}

        {/* Line 3: context tags.
            Buyer-side: "Re: <service>" (which service of theirs).
            Seller-side: "About: <my listing> · Re: <my service>" so
            the seller knows which of their own businesses is being
            inquired on, and which service. */}
        {(conv.serviceTitle || (isSeller && conv.listingBusinessName)) && (
          <div className="text-xs text-muted-foreground mt-1 truncate">
            {isSeller && conv.listingBusinessName && (
              <>About: <span className="text-foreground/80">{conv.listingBusinessName}</span></>
            )}
            {isSeller && conv.listingBusinessName && conv.serviceTitle && <span> · </span>}
            {conv.serviceTitle && (
              <>Re: <span className="text-foreground/80">{conv.serviceTitle}</span></>
            )}
          </div>
        )}

        {/* Line 4: member context — name · chapter · membership. */}
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {[
            conv.otherName,
            conv.otherChapter,
            conv.otherMembershipType ? MEMBERSHIP_LABEL[conv.otherMembershipType] : null,
          ].filter(Boolean).join(' · ')}
        </p>

        {/* Line 5: last-message preview. */}
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
