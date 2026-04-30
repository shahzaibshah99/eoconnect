import { createClient } from '@/lib/supabase/server'
import { ListingsTable, type AdminListing } from '@/components/admin/listings-table'

export default async function AdminListingsPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch the viewer's role so we can gate super-admin-only actions
  // (e.g. Transfer ownership) at the row level.
  const { data: me } = await db
    .from('profiles')
    .select('role')
    .eq('id', user!.id)
    .maybeSingle() as { data: { role: 'member' | 'chapter_admin' | 'super_admin' } | null }

  const { data: businesses } = await db
    .from('businesses')
    .select(`
      id, name, owner_id, status, city, country, created_at,
      profiles:profiles!owner_id (
        full_name, avatar_url, eo_chapter, eo_membership_type, eo_membership_email
      )
    `)
    .order('created_at', { ascending: false }) as { data: AdminListing[] | null }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Listings</h1>
        <p className="text-sm text-muted-foreground mt-1">All business listings on the platform — see owner, edit, manage services.</p>
      </div>
      <ListingsTable listings={businesses ?? []} isSuperAdmin={me?.role === 'super_admin'} />
    </div>
  )
}
