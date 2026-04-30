'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Send } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { sendMessage } from '@/actions/messages'
import { createClient } from '@/lib/supabase/client'

interface Message {
  id: string
  sender_id: string
  body: string
  created_at: string
}

interface MessageThreadProps {
  conversationId: string
  currentUserId: string
  otherName: string
  otherAvatar: string | null
  businessName: string | null
  initialMessages: Message[]
}

export function MessageThread({
  conversationId,
  currentUserId,
  otherName,
  otherAvatar,
  businessName,
  initialMessages,
}: MessageThreadProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [body, setBody] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Refs let the polling loop read the latest messages without re-creating
  // the interval every render (which would reset the timer constantly).
  const messagesRef = useRef<Message[]>(initialMessages)
  useEffect(() => { messagesRef.current = messages }, [messages])

  // Reset state when active conversation changes
  useEffect(() => {
    setMessages(initialMessages)
    messagesRef.current = initialMessages
  }, [conversationId, initialMessages])

  // Scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Live message updates via two independent paths so neither single
  // failure stalls the conversation:
  //
  //   1. Realtime postgres_changes — instant, but flaky in some networks
  //      (corporate firewalls blocking WebSockets, Supabase realtime
  //      service blips, project not on the realtime publication, etc.)
  //
  //   2. Polling every 5 seconds — reliable fallback. One small SELECT
  //      per active conversation; cheap. Also runs immediately when the
  //      tab regains focus so quickly switching tabs doesn't leave you
  //      with stale state.
  //
  // Both paths feed setMessages with dedup-by-id so duplicates never
  // appear if both fire for the same message.
  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    const merge = (incoming: Message[]) => {
      if (cancelled) return
      setMessages(prev => {
        const seen = new Set(prev.map(m => m.id))
        const additions = incoming.filter(m => !seen.has(m.id))
        if (additions.length === 0) return prev
        // Re-sort by created_at after merging. Realtime and polling can race —
        // a poll fetch that started before a realtime event arrives can land
        // older rows after newer ones. Without this re-sort, the visual
        // ordering breaks and the polling cursor (max created_at, computed
        // below) would be wrong, causing the next poll to refetch already-
        // seen rows or, worse, skip the gap entirely.
        return [...prev, ...additions].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      })
    }

    // Path 1: realtime
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => merge([payload.new as Message])
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[chat] realtime subscribed')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[chat] realtime status:', status, err)
        }
      })

    // Path 2: polling — safety net if realtime is silent.
    const fetchSinceLast = async () => {
      // Bail before we even hit the network if the effect has already torn
      // down — switching conversations rapidly otherwise queues stale
      // fetches that resolve and dump into the new conversation's state.
      if (cancelled) return
      // Use the MAX created_at across all known messages, not the array tail.
      // After merge() re-sorts the array tail is the newest, but we don't
      // rely on that invariant — if any caller ever appends without sorting,
      // a tail-based cursor would silently regress and trigger refetch loops.
      const lastTs = messagesRef.current.length > 0
        ? messagesRef.current.reduce(
            (max, m) => (m.created_at > max ? m.created_at : max),
            messagesRef.current[0].created_at
          )
        : new Date(0).toISOString()
      const { data, error: fetchErr } = await supabase
        .from('messages')
        .select('id, sender_id, body, created_at')
        .eq('conversation_id', conversationId)
        .gt('created_at', lastTs)
        .order('created_at', { ascending: true })
      if (cancelled) return
      if (fetchErr) {
        console.warn('[chat] poll error:', fetchErr.message)
        return
      }
      if (data && data.length > 0) merge(data as Message[])
    }

    const interval = setInterval(fetchSinceLast, 5000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchSinceLast() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setError(null)
    setBody('')
    const fd = new FormData()
    fd.set('conversation_id', conversationId)
    fd.set('body', text)
    startTransition(async () => {
      const result = await sendMessage(fd)
      if (result.error) {
        setError(result.error)
        setBody(text)
      }
    })
  }

  return (
    <>
      <div className="p-4 border-b border-border flex items-center gap-3">
        <Avatar className="h-9 w-9">
          <AvatarImage src={otherAvatar ?? undefined} />
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
            {otherName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-semibold text-sm">{otherName}</p>
          {businessName && <p className="text-xs text-muted-foreground">re: {businessName}</p>}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-10">
            No messages yet. Say hello!
          </p>
        ) : (
          messages.map(m => {
            const isMine = m.sender_id === currentUserId
            return (
              <div key={m.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[75%] rounded-2xl px-4 py-2 text-sm break-words',
                    isMine ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  )}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={cn('text-[10px] mt-1', isMine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                    {format(new Date(m.created_at), 'MMM d, h:mm a')}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-t border-destructive/20">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-3 border-t border-border flex gap-2">
        <Input
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Type a message…"
          disabled={isPending}
          className="flex-1"
        />
        <Button type="submit" disabled={isPending || !body.trim()} size="icon" className="bg-primary text-primary-foreground">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </>
  )
}
