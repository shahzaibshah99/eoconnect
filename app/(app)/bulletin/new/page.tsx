import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PostWizard } from '@/components/bulletin/post-wizard'

export const dynamic = 'force-dynamic'

/**
 * Post a Business Need — multi-step wizard.
 * Passes the category list server-side to avoid a client fetch.
 */
export default async function NewBulletinPostPage() {
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
        <h1 className="text-2xl font-bold">Post a Business Need</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tell the network what you&apos;re looking for. Matching businesses will be notified.
        </p>
      </div>
      <PostWizard categories={categories ?? []} />
    </div>
  )
}
