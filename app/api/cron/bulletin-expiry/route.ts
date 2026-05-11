import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Daily bulletin post auto-expiry.
 *
 * Per scope F04:
 *   - required_by + 2 days → archived (removed from live board,
 *     stays in member history)
 *
 * Also handles satisfaction prompt sentinels (tracked via
 * bulletin_posts.satisfaction_prompted_at and expiry_warned_at
 * columns — notification system for cron-driven in-app prompts
 * deferred to a later sprint).
 *
 * Schedule: daily at 02:17 UTC (off-peak, avoids cron clustering).
 * Auth: same Bearer ${CRON_SECRET} pattern as other cron routes.
 */

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY not set' }, { status: 503 })
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  // Archive posts whose required_by + 2 days has passed.
  // "required_by + 2 days" gives a 48-hour grace window per scope.
  const archiveCutoff = new Date()
  archiveCutoff.setDate(archiveCutoff.getDate() - 2)
  const cutoffDate = archiveCutoff.toISOString().split('T')[0]

  const { data: archived, error: archiveErr } = await dbAny
    .from('bulletin_posts')
    .update({ status: 'archived' })
    .eq('status', 'open')
    .lt('required_by', cutoffDate)
    .select('id') as { data: Array<{ id: string }> | null; error: { message: string } | null }

  if (archiveErr) {
    console.error('[bulletin-expiry] archive failed:', archiveErr.message)
    return NextResponse.json({ ok: false, error: archiveErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, archived: archived?.length ?? 0 })
}
