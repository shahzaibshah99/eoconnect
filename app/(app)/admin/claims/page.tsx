import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format, formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Clock, Mail, User } from 'lucide-react'

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
    .limit(500) as { data: ClaimRow[] | null }

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
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Business</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Invited email</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Invite sent</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Claimed by</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Claimed at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {listings.map(l => {
                const isClaimed = !!l.claimed_at
                const hasEmail  = !!l.claim_email_sent_at
                return (
                  <tr key={l.id} className={`hover:bg-muted/30 transition-colors ${isClaimed ? 'bg-green-500/5' : ''}`}>
                    <td className="px-4 py-3 font-medium">{l.name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs font-mono truncate max-w-[180px]" title={l.email ?? ''}>
                      {l.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {hasEmail ? (
                        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                          <Mail className="h-3 w-3" />
                          {format(new Date(l.claim_email_sent_at!), 'MMM d, HH:mm')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">Not sent</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isClaimed ? (
                        <Badge className="border bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 text-[10px] gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Claimed
                        </Badge>
                      ) : hasEmail ? (
                        <Badge className="border bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20 text-[10px] gap-1">
                          <Clock className="h-3 w-3" /> Pending
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">No invite</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {l.profiles ? (
                        <div className="flex items-start gap-1.5">
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="font-medium text-xs truncate">{l.profiles.full_name ?? '—'}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{l.profiles.eo_membership_email ?? ''}</p>
                            {l.profiles.eo_chapter && (
                              <p className="text-[10px] text-muted-foreground">{l.profiles.eo_chapter}</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {l.claimed_at ? (
                        <span title={format(new Date(l.claimed_at), 'PPpp')}>
                          {formatDistanceToNow(new Date(l.claimed_at), { addSuffix: true })}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
