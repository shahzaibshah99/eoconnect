import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PostCard, type PostCardItem } from '@/components/bulletin/post-card'
import { Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Business Needs bulletin board — lists open posts sorted by recency.
 * Per scope F04: all verified members can read; only verified members
 * can post (enforced in the submit action).
 *
 * F05 (Community Asks) will reuse this same page pattern with a
 * board_type='community' filter at a different route.
 */
export default async function BulletinPage() {
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
    .eq('board_type', 'business')
    .eq('status', 'open')
    .eq('tenant_id', 'eo')
    .order('created_at', { ascending: false })
    .limit(50) as { data: PostCardItem[] | null }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Business Needs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Members posting what they&apos;re looking for. Reply publicly if you can help.
          </p>
        </div>
        {user && (
          <Link
            href="/bulletin/new"
            className={cn(buttonVariants(), 'gap-1.5 shrink-0')}
          >
            <Plus className="h-4 w-4" /> Post a Need
          </Link>
        )}
      </div>

      {posts && posts.length > 0 ? (
        <div className="space-y-3">
          {posts.map(post => (
            <PostCard key={post.id} post={post} currentUserId={user?.id ?? null} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <p className="text-2xl mb-3">📋</p>
          <p className="font-semibold">No open needs yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Be the first to post what you&apos;re looking for.
          </p>
          {user && (
            <Link href="/bulletin/new" className={cn(buttonVariants(), 'mt-4 gap-1.5')}>
              <Plus className="h-4 w-4" /> Post a Need
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
