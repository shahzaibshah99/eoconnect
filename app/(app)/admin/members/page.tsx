import { createClient } from '@/lib/supabase/server'
import { MembersTable } from '@/components/admin/members-table'
import chaptersData from '@/lib/data/eo-chapters.json'
import type { Chapter } from '@/components/forms/chapter-picker'
import { describeChapterScope } from '@/lib/chapter-scope'

const CHAPTERS = chaptersData as Chapter[]

export default async function AdminMembersPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()

  const { data: me } = await db.from('profiles').select('role, admin_scope_country, admin_scope_city').eq('id', user!.id).single() as {
    data: {
      role: 'chapter_admin' | 'super_admin'
      admin_scope_country: string | null
      admin_scope_city: string | null
    } | null
  }

  let query = db.from('profiles').select('id, full_name, eo_chapter, role, status, created_at, eo_membership_email, admin_scope_country, admin_scope_city, chapter_country, chapter_city').order('created_at', { ascending: false })
  // Chapter admins only see members within their assigned scope.
  if (me?.role === 'chapter_admin' && me.admin_scope_country) {
    query = query.eq('chapter_country', me.admin_scope_country)
    if (me.admin_scope_city) query = query.eq('chapter_city', me.admin_scope_city)
  }

  const { data: members } = await query as {
    data: Array<{
      id: string
      full_name: string
      eo_chapter: string | null
      role: 'member' | 'chapter_admin' | 'super_admin'
      status: 'pending' | 'active' | 'suspended'
      created_at: string
      eo_membership_email: string | null
      admin_scope_country: string | null
      admin_scope_city: string | null
    }> | null
  }

  // Invited = pre-populated listings that haven't been claimed yet
  const { data: invitedListings } = await db
    .from('businesses')
    .select('id, name, email, created_at, claim_email_sent_at')
    .eq('is_pre_populated', true)
    .is('owner_id', null)
    .order('created_at', { ascending: false })
    .limit(200) as {
    data: Array<{ id: string; name: string; email: string | null; created_at: string; claim_email_sent_at: string | null }> | null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Members</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {me?.role === 'chapter_admin'
            ? `Members in your scope: ${describeChapterScope({ country: me.admin_scope_country, city: me.admin_scope_city })}.`
            : 'All members across all chapters.'}
        </p>
      </div>

      {/* Invited / unclaimed listings */}
      {invitedListings && invitedListings.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Invited — awaiting claim ({invitedListings.length})</h2>
            <span className="text-[11px] bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full font-medium">
              Claim email sent · no account yet
            </span>
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Business</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Email invited</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Invited</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Claim email sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invitedListings.map(l => (
                  <tr key={l.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{l.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{l.email ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {new Date(l.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {l.claim_email_sent_at
                        ? <span className="text-green-600 dark:text-green-400">✓ {new Date(l.claim_email_sent_at).toLocaleDateString()}</span>
                        : <span className="text-yellow-600">Pending</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MembersTable
        members={members ?? []}
        canChangeRole={me?.role === 'super_admin'}
        chapters={CHAPTERS}
      />
    </div>
  )
}
