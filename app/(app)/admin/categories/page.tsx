import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CategoriesManager } from '@/components/admin/categories-manager'

export default async function AdminCategoriesPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await db.from('profiles').select('role').eq('id', user!.id).single() as {
    data: { role: 'chapter_admin' | 'super_admin' } | null
  }

  if (me?.role !== 'super_admin') redirect('/admin/members')

  const { data: categories } = await db.from('categories').select('*').order('sort_order') as {
    data: Array<{
      id: string
      name: string
      slug: string
      icon: string | null
      sort_order: number
      active: boolean
    }> | null
  }

  const { data: bizRows } = await db
    .from('businesses')
    .select('category_ids')
    .eq('status', 'published') as { data: Array<{ category_ids: string[] | null }> | null }

  const bizCountByCategory: Record<string, number> = {}
  for (const biz of bizRows ?? []) {
    for (const catId of biz.category_ids ?? []) {
      bizCountByCategory[catId] = (bizCountByCategory[catId] ?? 0) + 1
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Categories</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add new categories or toggle existing ones. Updates are reflected on the marketplace immediately.
        </p>
      </div>
      <CategoriesManager categories={categories ?? []} bizCountByCategory={bizCountByCategory} />
    </div>
  )
}
