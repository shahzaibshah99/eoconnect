import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PostCard, type PostCardItem } from '@/components/bulletin/post-card'
import { Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Community Asks bulletin board — lists open posts sorted by recency.
 * Per scope F05: same structure as Business Needs (F04) but board_type='community'
 * and notifications go to geography-matched members instead of businesses.
 */
export default async function CommunityPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()

  const { data: posts } = await db
    .from('bulletin_posts')
    .select(`
      id, title, detail, category, tags, geography_country, geography_city,
      required_by, status, response_count, created_at,
      profiles!member_id (full_name, avatar_url, eo_chapter, verification_tag)
    `)
    .eq('board_type', 'community')
    .eq('status', 'open')
    .eq('tenant_id', 'eo')
    .order('created_at', { ascending: false })
    .limit(50) as { data: PostCardItem[] | null }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Community Asks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Members asking for advice, recommendations, or help from the network. Reply if you can contribute.
          </p>
        </div>
        {user && (
          <Link
            href="/community/new"
            className={cn(buttonVariants(), 'gap-1.5 shrink-0')}
          >
            <Plus className="h-4 w-4" /> Post a Community Ask
          </Link>
        )}
      </div>

      {posts && posts.length > 0 ? (
        <div className="space-y-3">
          {posts.map(post => (
            <PostCard key={post.id} post={post} basePath="/community" />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <p className="text-2xl mb-3">🤝</p>
          <p className="font-semibold">No open asks yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Be the first to ask the community for help.
          </p>
          {user && (
            <Link href="/community/new" className={cn(buttonVariants(), 'mt-4 gap-1.5')}>
              <Plus className="h-4 w-4" /> Post a Community Ask
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

