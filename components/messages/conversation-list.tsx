'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

export interface ConversationListItem {
  id: string
  otherName: string
  otherAvatar: string | null
  businessName: string | null
  businessLogo: string | null
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
        <Link
          key={c.id}
          href={`/dashboard/messages?conversation=${c.id}`}
          className={cn(
            'flex gap-3 p-4 border-b border-border hover:bg-muted/50 transition-colors',
            activeId === c.id && 'bg-muted'
          )}
        >
          <Avatar className="h-10 w-10 flex-shrink-0">
            <AvatarImage src={c.otherAvatar ?? undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
              {c.otherName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className={cn('text-sm truncate', c.unread ? 'font-bold' : 'font-medium')}>
                {c.otherName}
              </p>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: false })}
              </span>
            </div>
            {c.businessName && (
              <p className="text-xs text-muted-foreground truncate">re: {c.businessName}</p>
            )}
            <p className={cn('text-xs truncate mt-0.5', c.unread ? 'text-foreground font-medium' : 'text-muted-foreground')}>
              {c.lastMessageBody ?? 'No messages yet'}
            </p>
          </div>
          {c.unread && <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-2" />}
        </Link>
      ))}
    </div>
  )
}
