'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Paperclip, Send, X, FileText } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { sendMessage } from '@/actions/messages'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  formatChatAttachmentSize,
  uploadChatAttachment,
  validateChatAttachment,
} from '@/lib/chat-attachments'

interface Message {
  id: string
  sender_id: string
  body: string
  created_at: string
  attachment_url?: string | null
  attachment_name?: string | null
  attachment_mime?: string | null
  attachment_size?: number | null
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
  const [otherIsTyping, setOtherIsTyping] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Realtime channel ref so the form submit handler can broadcast a
  // "typing" event on the same channel the receive effect subscribes to.
  // Stored in a ref because the channel is created inside the
  // conversationId-keyed useEffect — capturing it in component-level
  // state would force a re-render every time we (re)subscribe.
  const channelRef = useRef<RealtimeChannel | null>(null)
  // Throttle outbound typing broadcasts so a fast typer doesn't spam
  // the channel with one event per keystroke.
  const lastTypingSentRef = useRef(0)
  const typingClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

    // Path 1: realtime — INSERTs for new messages plus a "typing"
    // broadcast event for the typing indicator. Typing uses broadcast
    // (not postgres_changes) because it's ephemeral and doesn't need
    // to round-trip through the DB.
    const channel = supabase
      .channel(`messages:${conversationId}`, {
        config: { broadcast: { self: false } },
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => merge([payload.new as Message])
      )
      .on('broadcast', { event: 'typing' }, (payload) => {
        const senderId = (payload.payload as { sender_id?: string } | undefined)?.sender_id
        if (!senderId || senderId === currentUserId) return
        if (cancelled) return
        setOtherIsTyping(true)
        // Auto-clear after 3s with no further typing events. Clearing on
        // each new event keeps the indicator alive while the other party
        // is actively typing.
        if (typingClearTimeoutRef.current) clearTimeout(typingClearTimeoutRef.current)
        typingClearTimeoutRef.current = setTimeout(() => setOtherIsTyping(false), 3000)
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[chat] realtime subscribed')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[chat] realtime status:', status, err)
        }
      })
    channelRef.current = channel

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
        .select('id, sender_id, body, created_at, attachment_url, attachment_name, attachment_mime, attachment_size')
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
      channelRef.current = null
      if (typingClearTimeoutRef.current) {
        clearTimeout(typingClearTimeoutRef.current)
        typingClearTimeoutRef.current = null
      }
      // Always clear the indicator on teardown — otherwise switching
      // conversations could leave the previous "typing…" hanging.
      setOtherIsTyping(false)
    }
  }, [conversationId, currentUserId])

  // Broadcast that the current user is typing. Throttled to one event
  // per 1.5s — sufficient to keep the receiver's 3s auto-clear timer
  // refreshed, light enough that a 60-wpm typist doesn't push 60+
  // events per minute through the channel.
  const broadcastTyping = () => {
    const channel = channelRef.current
    if (!channel) return
    const now = Date.now()
    if (now - lastTypingSentRef.current < 1500) return
    lastTypingSentRef.current = now
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { sender_id: currentUserId },
    })
  }

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset the input value so picking the same file twice in a row
    // (e.g. after an upload error) re-fires onChange. Without this,
    // selecting the same file looks like nothing happened.
    if (e.target) e.target.value = ''
    if (!file) return
    const validation = validateChatAttachment(file)
    if (validation) {
      setError(validation.message)
      return
    }
    setError(null)
    setPendingFile(file)
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const text = body.trim()
    // Allow empty body when there's a file attached.
    if (!text && !pendingFile) return
    setError(null)

    const file = pendingFile
    setBody('')
    setPendingFile(null)

    startTransition(async () => {
      const fd = new FormData()
      fd.set('conversation_id', conversationId)
      fd.set('body', text)

      if (file) {
        setIsUploading(true)
        try {
          const uploaded = await uploadChatAttachment(conversationId, file)
          fd.set('attachment_url', uploaded.url)
          fd.set('attachment_name', uploaded.name)
          fd.set('attachment_mime', uploaded.mime)
          fd.set('attachment_size', String(uploaded.size))
        } catch (err) {
          setIsUploading(false)
          setError(err instanceof Error ? err.message : 'Upload failed')
          // Restore so the user can retry without re-picking.
          setBody(text)
          setPendingFile(file)
          return
        }
        setIsUploading(false)
      }

      const result = await sendMessage(fd)
      if (result.error) {
        setError(result.error)
        setBody(text)
        setPendingFile(file)
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
        {messages.length === 0 && !otherIsTyping ? (
          <p className="text-center text-sm text-muted-foreground py-10">
            No messages yet. Say hello!
          </p>
        ) : (
          messages.map(m => {
            const isMine = m.sender_id === currentUserId
            const hasAttachment = !!m.attachment_url
            const isImage = hasAttachment && (m.attachment_mime?.startsWith('image/') ?? false)
            return (
              <div key={m.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[75%] rounded-2xl px-4 py-2 text-sm break-words',
                    isMine ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  )}
                >
                  {hasAttachment && isImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a
                      href={m.attachment_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block mb-1.5 -mx-1.5 -mt-1"
                    >
                      <img
                        src={m.attachment_url!}
                        alt={m.attachment_name ?? 'attachment'}
                        className="rounded-lg max-h-60 object-cover w-full"
                      />
                    </a>
                  )}
                  {hasAttachment && !isImage && (
                    <a
                      href={m.attachment_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={m.attachment_name ?? undefined}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-3 py-2 mb-1.5 transition-colors',
                        isMine
                          ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20'
                          : 'bg-background hover:bg-background/80 border border-border'
                      )}
                    >
                      <FileText className="h-5 w-5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-xs truncate">{m.attachment_name ?? 'File'}</p>
                        {typeof m.attachment_size === 'number' && (
                          <p className={cn('text-[10px]', isMine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                            {formatChatAttachmentSize(m.attachment_size)}
                          </p>
                        )}
                      </div>
                    </a>
                  )}
                  {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                  <p className={cn('text-[10px] mt-1', isMine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                    {format(new Date(m.created_at), 'MMM d, h:mm a')}
                  </p>
                </div>
              </div>
            )
          })
        )}
        {otherIsTyping && (
          <div className="flex justify-start" aria-live="polite">
            <div className="bg-muted rounded-2xl px-4 py-2 flex items-center gap-1">
              <span className="sr-only">{otherName} is typing</span>
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-t border-destructive/20">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-3 border-t border-border flex flex-col gap-2">
        {pendingFile && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{pendingFile.name}</p>
              <p className="text-muted-foreground">
                {formatChatAttachmentSize(pendingFile.size)}
                {isUploading && ' · uploading…'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              disabled={isUploading || isPending}
              className="text-muted-foreground hover:text-foreground p-1 -m-1"
              aria-label="Remove attachment"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFilePick}
            className="hidden"
            // Hint to mobile pickers without restricting desktop choice
            // — server-side validation is the real gate.
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending || isUploading || !!pendingFile}
            aria-label="Attach file"
            title={`Attach a file (max ${formatChatAttachmentSize(CHAT_ATTACHMENT_MAX_BYTES)})`}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input
            value={body}
            onChange={e => {
              setBody(e.target.value)
              if (e.target.value.length > 0) broadcastTyping()
            }}
            placeholder="Type a message…"
            disabled={isPending}
            className="flex-1"
          />
          <Button
            type="submit"
            disabled={isPending || isUploading || (!body.trim() && !pendingFile)}
            size="icon"
            className="bg-primary text-primary-foreground"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </>
  )
}
