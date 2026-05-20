'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { replyToPost } from '@/actions/bulletin'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatDistanceToNow, format } from 'date-fns'
import Link from 'next/link'
import { MessageSquare, ChevronDown, Sparkles } from 'lucide-react'
import type { ReferralSearchResult } from '@/lib/ai/referral-search'
import { MentionTextarea, renderMentions } from '@/components/bulletin/mention-textarea'

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
  aiReferrals?: ReferralSearchResult[]
  collapseAfter: number
  isOwner: boolean
  businessByOwner?: Record<string, string>
}

/**
 * Public reply thread per scope F04.
 * - All verified members can reply
 * - Thread collapses after THREAD_COLLAPSE_AFTER replies (scope: 3)
 * - Shows reply count and expand toggle
 * - Closed when post is fulfilled or expired
 */
export function ReplyThread({
  postId, replies, currentUserId, isClosed, collapseAfter, isOwner: _isOwner, aiReferrals = [], businessByOwner = {},
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

      {/* F18: AI concierge — top-3 referrals from similar past posts */}
      {aiReferrals.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            From similar past posts
          </div>
          {aiReferrals.map(ref => (
            <AiReferralCard key={ref.id} referral={ref} />
          ))}
        </div>
      )}

      {replies.length > 0 && (
        <div className="space-y-3">
          {visibleReplies.map(reply => (
            <ReplyCard
              key={reply.id}
              reply={reply}
              isCurrentUser={reply.responder_member_id === currentUserId}
              businessId={businessByOwner[reply.responder_member_id]}
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
          <MentionTextarea
            value={body}
            onChange={setBody}
            placeholder="Share how you or your business can help… type @ to mention a member or business"
            rows={3}
            maxLength={2000}
            disabled={isPending}
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

/**
 * AI-surfaced referral card. Per scope F18: same thread format as a reply
 * but labelled "AI: From a similar past post [date]". Shown before live
 * replies so members see the collective network intelligence first.
 */
function AiReferralCard({ referral }: { referral: ReferralSearchResult }) {
  return (
    <div className="flex gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
      <div className="h-8 w-8 shrink-0 mt-0.5 rounded-full bg-primary/20 flex items-center justify-center">
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
            AI · From a similar past post
          </span>
          <span className="text-[11px] text-muted-foreground ml-auto">
            {format(new Date(referral.created_at), 'MMM d, yyyy')}
          </span>
        </div>
        <p className="text-sm">
          <strong>{referral.referred_name}</strong>
          {referral.referred_category && ` — ${referral.referred_category}`}
          {referral.referred_location && ` in ${referral.referred_location}`}
        </p>
        {referral.full_text && (
          <p className="text-xs text-muted-foreground mt-1 italic">
            &ldquo;{referral.full_text}&rdquo;
          </p>
        )}
      </div>
    </div>
  )
}

function ReplyCard({ reply, isCurrentUser, businessId }: { reply: Reply; isCurrentUser: boolean; businessId?: string }) {
  const profileHref = businessId ? `/marketplace/${businessId}` : undefined

  const avatarEl = (
    <Avatar className="h-8 w-8 shrink-0 mt-0.5">
      <AvatarImage src={reply.profiles?.avatar_url ?? undefined} />
      <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
        {(reply.profiles?.full_name ?? '?').charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )

  return (
    <div className={`flex gap-3 p-4 rounded-xl border ${isCurrentUser ? 'bg-primary/5 border-primary/20' : 'bg-card border-border'}`}>
      {profileHref ? <Link href={profileHref}>{avatarEl}</Link> : avatarEl}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap mb-1">
          {profileHref ? (
            <Link href={profileHref} className="text-sm font-medium text-primary hover:underline underline-offset-2">
              {reply.profiles?.full_name ?? 'Member'}
            </Link>
          ) : (
            <span className="text-sm font-medium">{reply.profiles?.full_name ?? 'Member'}</span>
          )}
          {reply.profiles?.eo_chapter && (
            <span className="text-[11px] text-muted-foreground">{reply.profiles.eo_chapter}</span>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto">
            {formatDistanceToNow(new Date(reply.created_at), { addSuffix: true })}
          </span>
        </div>
        <p className="text-sm whitespace-pre-line">{renderMentions(reply.content)}</p>
      </div>
    </div>
  )
}
