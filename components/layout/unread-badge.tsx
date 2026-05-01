'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface UnreadBadgeProps {
  userId: string | null
  initialUnread: number
}

/**
 * Small bubble showing the unread-message count.
 *
 * Subscribes to message INSERT events and bumps the count when one
 * arrives from someone other than the current user. Resets to 0
 * when the user navigates into the messages page (the page marks
 * messages read server-side; we mirror that on the client).
 *
 * Returns null when there's nothing to show — keeps callers simple
 * because they don't have to conditionally render based on count.
 *
 * Extracted from MessagesNavLink so the same logic can render in
 * the desktop navbar AND in the mobile hamburger dropdown without
 * duplicating the realtime + counter wiring. Mobile previously had
 * no badge at all because the hamburger menu just rendered a
 * generic <Link>Messages</Link>.
 */
export function UnreadBadge({ userId, initialUnread }: UnreadBadgeProps) {
  const pathname = usePathname()
  const [count, setCount] = useState(initialUnread)
  const isActive = pathname.startsWith('/dashboard/messages')

  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`unread-badge-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new as { sender_id?: string } | null
          if (!m || typeof m.sender_id !== 'string') return
          if (m.sender_id === userId) return
          setCount(c => c + 1)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  useEffect(() => {
    if (isActive && count > 0) setCount(0)
  }, [isActive, count])

  if (count <= 0) return null

  return (
    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-primary text-primary-foreground flex-shrink-0">
      {count > 99 ? '99+' : count}
    </span>
  )
}
