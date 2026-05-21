import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AuditLog, type AuditEvent } from '@/components/admin/audit-log'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

const SERVER_PAGE_SIZE = 1000

interface PageProps {
  searchParams: Promise<{ category?: string; window?: string; page?: string }>
}

// Hoisted out of the component body so the impure-function lint rule
// (which assumes the body is a React render) doesn't flag Date.now().
// This is a server component executed per request — clock reads are
// expected and correct behaviour.
function windowToCutoffIso(win: string): string | null {
  if (win === 'all') return null
  const days = win === '24h' ? 1 : win === '7d' ? 7 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Read-only platform audit timeline. super_admin only.
 *
 * Reads from events_log, joining the admin profile so we can display
 * who performed each action. Returns the most recent PAGE_SIZE rows
 * within the optional time window (defaults to 30 days). The component
 * does its own client-side filtering by category for instant feedback;
 * the time window is server-side because it constrains the query.
 *
 * Per scope F15: "Timestamped action log — every admin action recorded".
 * Source-of-truth source for compliance asks and for the eventual
 * analytics layer (F16) — the latter reads aggregates from this table.
 */
export default async function AdminAuditPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: 'member' | 'chapter_admin' | 'super_admin' } | null }

  if (me?.role !== 'super_admin') redirect('/admin')

  // Map UI window → cutoff date. Defaults to 30 days; 'all' lifts the
  // bound entirely (capped by PAGE_SIZE).
  const win = params.window ?? '30d'
  const serverPage = Math.max(0, parseInt(params.page ?? '0', 10) || 0)
  const sinceIso = windowToCutoffIso(win)

  const offset = serverPage * SERVER_PAGE_SIZE

  let countQ = db
    .from('events_log')
    .select('id', { count: 'exact', head: true })
  if (sinceIso) countQ = countQ.gte('created_at', sinceIso)
  const { count: totalCount } = await countQ as { count: number | null }

  let q = db
    .from('events_log')
    .select(`
      id, type, member_id, entity_id, metadata, tenant_id, created_at,
      profiles!member_id (full_name, avatar_url, eo_chapter)
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + SERVER_PAGE_SIZE - 1)

  if (sinceIso) q = q.gte('created_at', sinceIso)

  const { data: events } = await q as { data: AuditEvent[] | null }

  const hasMore = (events?.length ?? 0) === SERVER_PAGE_SIZE

  const buildUrl = (p: number) => {
    const sp = new URLSearchParams()
    if (win !== '30d') sp.set('window', win)
    if (p > 0) sp.set('page', String(p))
    const qs = sp.toString()
    return `/admin/audit${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every admin action, in order. Showing {offset + 1}–{offset + (events?.length ?? 0)} of <strong className="text-foreground">{totalCount ?? '…'}</strong> total
          {win === 'all' ? ' across all time' : ` from the last ${win === '24h' ? '24 hours' : win === '7d' ? '7 days' : '30 days'}`}.
        </p>
      </div>
      <AuditLog events={events ?? []} initialWindow={win as '24h' | '7d' | '30d' | 'all'} />
      {(serverPage > 0 || hasMore) && (
        <div className="flex items-center justify-between pt-2">
          {serverPage > 0 ? (
            <Link href={buildUrl(serverPage - 1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" /> Newer
            </Link>
          ) : <span />}
          {hasMore && (
            <Link href={buildUrl(serverPage + 1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              Older <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
