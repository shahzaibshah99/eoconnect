'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { replyToPost } from '@/actions/bulletin'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatDistanceToNow } from 'date-fns'
import { MessageSquare, ChevronDown } from 'lucide-react'

interface Reply {
  id: string
  content: string
  created_at: string
  responder_member_id: string
  profiles: {
    full_name: string | null
    avatar_url: string | null
    eo_chapter: string | null
    verification_tag: string | null
  } | null
}

interface ReplyThreadProps {
  postId: string
  replies: Reply[]
  currentUserId: string | null
  isClosed: boolean
  collapseAfter: number
  isOwner: boolean
}

/**
 * Public reply thread per scope F04.
 * - All verified members can reply
 * - Thread collapses after THREAD_COLLAPSE_AFTER replies (scope: 3)
 * - Shows reply count and expand toggle
 * - Closed when post is fulfilled or expired
 */
export function ReplyThread({
  postId, replies, currentUserId, isClosed, collapseAfter, isOwner: _isOwner,
}: ReplyThreadProps) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const visibleReplies = expanded ? replies : replies.slice(0, collapseAfter)
  const hiddenCount = replies.length - collapseAfter

  const submit = () => {
    if (!body.trim()) { setError('Reply cannot be empty'); return }
    setError(null)
    startTransition(async () => {
      const res = await replyToPost({ post_id: postId, content: body.trim() })
      if (res.error) { setError(res.error); return }
      setBody('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MessageSquare className="h-4 w-4" />
        {replies.length === 0
          ? 'No replies yet'
          : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`
        }
      </div>

      {replies.length > 0 && (
        <div className="space-y-3">
          {visibleReplies.map(reply => (
            <ReplyCard
              key={reply.id}
              reply={reply}
              isCurrentUser={reply.responder_member_id === currentUserId}
            />
          ))}

          {!expanded && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground py-1"
            >
              <ChevronDown className="h-4 w-4" />
              Show {hiddenCount} more {hiddenCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      )}

      {/* Reply form — only when post is open and user is logged in */}
      {!isClosed && currentUserId && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Add a reply
          </p>
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Share how you or your business can help…"
            rows={3}
            maxLength={2000}
            disabled={isPending}
            className="resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">{body.length}/2000</p>
            <Button size="sm" onClick={submit} disabled={isPending || !body.trim()}>
              {isPending ? 'Posting…' : 'Post reply'}
            </Button>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
      )}

      {isClosed && (
        <p className="text-sm text-muted-foreground text-center py-2 border border-dashed border-border rounded-lg">
          This post is closed — no further replies.
        </p>
      )}

      {!currentUserId && !isClosed && (
        <p className="text-sm text-muted-foreground text-center py-2 border border-dashed border-border rounded-lg">
          <a href="/login" className="text-primary hover:underline">Sign in</a> to reply.
        </p>
      )}
    </div>
  )
}

function ReplyCard({ reply, isCurrentUser }: { reply: Reply; isCurrentUser: boolean }) {
  return (
    <div className={`flex gap-3 p-4 rounded-xl border ${isCurrentUser ? 'bg-primary/5 border-primary/20' : 'bg-card border-border'}`}>
      <Avatar className="h-8 w-8 shrink-0 mt-0.5">
        <AvatarImage src={reply.profiles?.avatar_url ?? undefined} />
        <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
          {(reply.profiles?.full_name ?? '?').charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap mb-1">
          <span className="text-sm font-medium">{reply.profiles?.full_name ?? 'Member'}</span>
          {reply.profiles?.eo_chapter && (
            <span className="text-[11px] text-muted-foreground">{reply.profiles.eo_chapter}</span>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto">
            {formatDistanceToNow(new Date(reply.created_at), { addSuffix: true })}
          </span>
        </div>
        <p className="text-sm whitespace-pre-line">{reply.content}</p>
      </div>
    </div>
  )
}
