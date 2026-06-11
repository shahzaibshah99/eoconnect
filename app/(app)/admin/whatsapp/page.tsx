import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { toggleWhatsappAgent } from '@/actions/whatsapp-admin'

export const dynamic = 'force-dynamic'

type ClassificationRow = {
  id: string
  created_at: string
  waha_message_id: string
  message_text: string | null
  intent: string
  confidence: number | null
  sensitive: boolean
  dropped: boolean
  post_id: string | null
}

export default async function AdminWhatsAppPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null }

  if (me?.role !== 'super_admin') redirect('/admin')

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Feature flag state
  const { data: flag } = await db
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_name', 'whatsapp_agent_enabled')
    .maybeSingle() as { data: { is_enabled: boolean } | null }

  const agentEnabled = flag?.is_enabled ?? false

  // Last 7 days of classification logs
  const { data: logs } = await db
    .from('whatsapp_classification_log')
    .select('id, created_at, waha_message_id, message_text, intent, confidence, sensitive, dropped, post_id')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500) as { data: ClassificationRow[] | null }

  // Summary
  const summary = (logs ?? []).reduce((acc, row) => {
    acc.total++
    acc[row.intent] = (acc[row.intent] ?? 0) + 1
    if (!row.dropped) acc.posts_created++
    if (row.sensitive) acc.sensitive++
    return acc
  }, { total: 0, posts_created: 0, sensitive: 0 } as Record<string, number>)

  // Shadow users
  const { count: shadowCount } = await db
    .from('shadow_users')
    .select('id', { count: 'exact', head: true })
    .is('linked_user_id', null) as { count: number | null }

  const { count: linkedCount } = await db
    .from('shadow_users')
    .select('id', { count: 'exact', head: true })
    .not('linked_user_id', 'is', null) as { count: number | null }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">WhatsApp Integration</h1>
          <p className="text-sm text-muted-foreground mt-1">Last 7 days of activity from the WAHA integration.</p>
        </div>

        {/* Kill-switch toggle */}
        <form action={async () => {
          'use server'
          await toggleWhatsappAgent(!agentEnabled)
        }}>
          <button
            type="submit"
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              agentEnabled
                ? 'bg-green-600 hover:bg-green-700 text-white border-green-700'
                : 'bg-muted hover:bg-muted/80 text-foreground border-border'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${agentEnabled ? 'bg-white' : 'bg-gray-400'}`} />
            Agent {agentEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </form>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Messages (7d)', value: summary.total },
          { label: 'Posts Created', value: summary.posts_created },
          { label: 'Shadow Users', value: shadowCount ?? 0 },
          { label: 'Linked Accounts', value: linkedCount ?? 0 },
        ].map(card => (
          <div key={card.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
            <p className="text-2xl font-bold mt-1">{card.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Classification breakdown */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Classification breakdown (7d)</h2>
        <div className="grid grid-cols-3 gap-4 text-sm">
          {[
            { label: 'Needs', key: 'need' },
            { label: 'Leads', key: 'lead' },
            { label: 'Noise', key: 'noise' },
          ].map(({ label, key }) => (
            <div key={key} className="text-center">
              <p className="text-2xl font-bold">{summary[key] ?? 0}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent classification log */}
      <div>
        <h2 className="text-base font-semibold mb-3">Recent classifications</h2>
        <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          {(logs ?? []).length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No messages in the last 7 days.</p>
          )}
          {(logs ?? []).slice(0, 50).map(log => (
            <div key={log.id} className="p-3 text-sm flex items-start gap-3">
              <span className={`mt-0.5 shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                log.intent === 'need' ? 'bg-green-100 text-green-700' :
                log.intent === 'lead' ? 'bg-blue-100 text-blue-700' :
                log.sensitive ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {log.sensitive ? 'sensitive' : log.intent}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-muted-foreground truncate text-xs">
                  {new Date(log.created_at).toLocaleString()}
                  {!log.dropped && log.post_id && <span className="ml-2 text-green-600">→ post created</span>}
                  {log.dropped && <span className="ml-2 text-muted-foreground">dropped</span>}
                </p>
                <p className="truncate mt-0.5">{log.message_text?.slice(0, 120) ?? '—'}</p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {log.confidence != null ? `${Math.round(log.confidence * 100)}%` : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
