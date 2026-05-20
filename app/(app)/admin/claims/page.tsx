import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ClaimsTable } from '@/components/admin/claims-table'

export const dynamic = 'force-dynamic'

type ClaimRow = {
  id: string
  name: string
  email: string | null
  created_at: string
  claim_email_sent_at: string | null
  claimed_at: string | null
  owner_id: string | null
  profiles?: {
    full_name: string | null
    eo_membership_email: string | null
    eo_chapter: string | null
    verification_tag: string | null
  } | null
}

export default async function AdminClaimsPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await db
    .from('profiles').select('role').eq('id', user.id).single() as { data: { role: string } | null }
  if (!me || !['chapter_admin', 'super_admin'].includes(me.role)) redirect('/admin')

  const { data: rows } = await db
    .from('businesses')
    .select(`
      id, name, email, created_at, claim_email_sent_at, claimed_at, owner_id,
      profiles!owner_id ( full_name, eo_membership_email, eo_chapter, verification_tag )
    `)
    .eq('is_pre_populated', true)
    .order('created_at', { ascending: false })
    .limit(5000) as { data: ClaimRow[] | null }

  const listings = rows ?? []
  const claimed   = listings.filter(l => l.claimed_at)
  const unclaimed = listings.filter(l => !l.claimed_at && l.claim_email_sent_at)
  const noEmail   = listings.filter(l => !l.claim_email_sent_at)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Claims tracker</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every pre-populated listing — invite sent, claimed, and member details.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-green-600 dark:text-green-400">{claimed.length}</p>
          <p className="text-sm text-muted-foreground mt-1">Claimed</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">{unclaimed.length}</p>
          <p className="text-sm text-muted-foreground mt-1">Invite sent · awaiting</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-muted-foreground">{noEmail.length}</p>
          <p className="text-sm text-muted-foreground mt-1">No invite sent</p>
        </div>
      </div>

      {listings.length === 0 ? (
        <div className="bg-card border border-border rounded-xl text-center py-16 text-sm text-muted-foreground">
          No pre-populated listings yet. Use CSV imports to create them.
        </div>
      ) : (
        <ClaimsTable listings={listings} />
      )}
    </div>
  )
}
