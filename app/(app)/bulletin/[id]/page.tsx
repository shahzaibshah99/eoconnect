import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MapPin, Clock, ArrowLeft } from 'lucide-react'
import { format, formatDistanceToNow, differenceInDays } from 'date-fns'
import { ReplyThread } from '@/components/bulletin/reply-thread'
import { PostActions } from '@/components/bulletin/post-actions'
import { THREAD_COLLAPSE_AFTER } from '@/lib/bulletin-constants'
import { searchReferrals, type ReferralSearchResult } from '@/lib/ai/referral-search'

export const dynamic = 'force-dynamic'

interface PageProps { params: Promise<{ id: string }> }

export default async function BulletinPostPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()

  const [postRes, repliesRes] = await Promise.all([
    db
      .from('bulletin_posts')
      .select(`
        id, title, detail, category, tags, geography_country, geography_city,
        required_by, status, response_count, ai_feedback, matched_business_ids,
        created_at, member_id, board_type,
        profiles!member_id (full_name, avatar_url, eo_chapter, verification_tag)
      `)
      .eq('id', id)
      .single(),
    db
      .from('post_responses')
      .select(`
        id, content, created_at, responder_member_id,
        profiles!responder_member_id (full_name, avatar_url, eo_chapter, verification_tag)
      `)
      .eq('post_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (!postRes.data) notFound()
  const post = postRes.data
  const replies = repliesRes.data ?? []

  // Fetch business IDs for reply authors so their name links to their listing.
  const responderIds = [...new Set(replies.map((r: { responder_member_id: string }) => r.responder_member_id))]
  const businessByOwner: Record<string, string> = {}
  if (responderIds.length > 0) {
    const { data: bizRows } = await db
      .from('businesses')
      .select('id, owner_id')
      .in('owner_id', responderIds)
      .neq('status', 'archived') as { data: Array<{ id: string; owner_id: string }> | null }
    for (const b of bizRows ?? []) businessByOwner[b.owner_id] = b.id
  }

  // F18: surface top-3 AI past referrals for this post's topic.
  // Runs server-side so it shows on first load without a client fetch.
  // Falls back to [] when OPENAI_API_KEY is missing or DB has no referrals yet.
  let aiReferrals: ReferralSearchResult[] = []
  try {
    const queryText = [post.title, post.detail].filter(Boolean).join('\n')
    if (queryText) {
      aiReferrals = await searchReferrals(db, {
        queryText,
        boardType: (post.board_type ?? 'business') as 'business' | 'community',
        matchCount: 3,
      })
    }
  } catch {
    // Non-blocking — silently skip if search fails
  }

  const isOwner = user?.id === post.member_id
  const isFulfilled = post.status === 'fulfilled'
  const requiredBy = new Date(post.required_by)
  const daysLeft = differenceInDays(requiredBy, new Date())
  const location = [post.geography_city, post.geography_country].filter(Boolean).join(', ')

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back */}
      <Link href="/bulletin" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'gap-1.5 -ml-2')}>
        <ArrowLeft className="h-4 w-4" /> Business Needs
      </Link>

      {/* Post card */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={post.profiles?.avatar_url ?? undefined} />
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
              {(post.profiles?.full_name ?? '?').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{post.profiles?.full_name ?? 'Member'}</p>
            <p className="text-xs text-muted-foreground">
              {post.profiles?.eo_chapter && `${post.profiles.eo_chapter} · `}
              {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
            </p>
          </div>
          {isFulfilled && (
            <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20 text-[10px]">
              Fulfilled
            </Badge>
          )}
        </div>

        <div>
          <h1 className="text-xl font-bold leading-snug">{post.title}</h1>
          {post.detail && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{post.detail}</p>}
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">{post.category}</Badge>
          {location && (
            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{location}</span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {daysLeft < 0
              ? `Needed by ${format(requiredBy, 'MMM d, yyyy')} (expired)`
              : daysLeft === 0
                ? 'Needed today'
                : `Needed by ${format(requiredBy, 'MMM d, yyyy')} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`
            }
          </span>
        </div>

        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {post.tags.map((tag: string) => (
              <span key={tag} className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Post owner actions */}
        {isOwner && !isFulfilled && (
          <PostActions
            postId={post.id}
            boardType={(post.board_type ?? 'business') as 'business' | 'community'}
            aiReferrals={aiReferrals}
          />
        )}
      </div>

      {/* Reply thread — AI referral cards appear at the top of the thread */}
      <ReplyThread
        postId={post.id}
        replies={replies}
        currentUserId={user?.id ?? null}
        isClosed={isFulfilled || post.status !== 'open'}
        collapseAfter={THREAD_COLLAPSE_AFTER}
        isOwner={isOwner}
        aiReferrals={aiReferrals}
        businessByOwner={businessByOwner}
      />
    </div>
  )
}
