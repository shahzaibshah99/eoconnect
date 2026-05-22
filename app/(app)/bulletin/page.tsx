import { createClient } from '@/lib/supabase/server'
import { BulletinFeed } from '@/components/bulletin/bulletin-feed'

export const dynamic = 'force-dynamic'

export default async function BulletinPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()

  const { data: posts } = await db
    .from('bulletin_posts')
    .select(`
      id, title, detail, category, tags, geography_country, geography_city,
      required_by, status, response_count, created_at, board_type,
      profiles!member_id (full_name, avatar_url, eo_chapter, verification_tag)
    `)
    .eq('status', 'open')
    .eq('tenant_id', 'eo')
    .order('created_at', { ascending: false })
    .limit(100) as { data: Array<{
      id: string
      title: string
      detail: string | null
      category: string
      tags: string[]
      geography_country: string | null
      geography_city: string | null
      required_by: string
      status: 'open' | 'fulfilled' | 'expired' | 'archived'
      response_count: number
      created_at: string
      board_type: 'business' | 'community'
      profiles: { full_name: string | null; avatar_url: string | null; eo_chapter: string | null; verification_tag: string | null } | null
    }> | null }

  return (
    <BulletinFeed
      posts={posts ?? []}
      isLoggedIn={!!user}
    />
  )
}
