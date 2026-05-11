import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PostWizard } from '@/components/bulletin/post-wizard'

export const dynamic = 'force-dynamic'

/**
 * Post a Community Ask — same wizard as Business Needs but boardType='community'.
 * On submit: notifies geography-matched members instead of tag-matched businesses.
 */
export default async function NewCommunityPostPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: categories } = await db
    .from('categories')
    .select('id, name, slug')
    .eq('active', true)
    .order('sort_order') as { data: Array<{ id: string; name: string; slug: string }> | null }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Post a Community Ask</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ask the network for advice, contacts, or help. Verified members in your area will be notified.
        </p>
      </div>
      <PostWizard categories={categories ?? []} boardType="community" />
    </div>
  )
}
