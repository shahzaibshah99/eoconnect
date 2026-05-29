import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  sendEmail,
  slowReplierDay60Email,
  slowReplierDay85Email,
} from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'

/**
 * Slow-replier nudges + flag flip.
 *
 * Per scope F02:
 *   60 days no login → "your listings miss you" reminder
 *   85 days no login → "5 days until flagged" final nudge
 *   90 days no login → flip businesses.slow_replier=true (greyed in
 *                      search, "Slow replier" label visible). Listings
 *                      stay searchable and accessible.
 *
 * The flag is also reversible: if a member logs in after being flagged,
 * the next run of this cron (or the auth callback, future) will clear
 * slow_replier=false. For now we clear it lazily via this cron — at
 * <60 days inactive, set slow_replier=false on all owned listings.
 *
 * Idempotency: the 60d and 85d nudges write events_log sentinels and
 * filter against them on next run. The flag-flip is a SQL update that's
 * naturally idempotent (NOOP if already true).
 *
 * Schedule: daily at 09:17 UTC (vercel.json) — 4 minutes after the
 * verification reminder cron so they don't compete for the same
 * function-instance bandwidth.
 *
 * Auth: same Bearer pattern as other cron routes.
 */

export const maxDuration = 120

interface OwnerRow {
  id: string
  full_name: string | null
  eo_membership_email: string | null
  last_login_at: string | null
  tenant_id: string
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (process.env.DISABLE_EMAIL_REMINDERS !== 'false') {
    return NextResponse.json({ skipped: true, reason: 'DISABLE_EMAIL_REMINDERS' })
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

  const summary = {
    nudge_60: 0,
    nudge_85: 0,
    flagged: 0,
    cleared: 0,
    errors: 0,
  }

  // ── Day 60 nudge ─────────────────────────────────────────────
  await runOwnerNudge({
    dbAny, summary, kind: '60',
    minDaysInactive: 60, maxDaysInactive: 84,
    sentinel: 'slow_replier_nudge_60_sent',
    counter: 'nudge_60',
    template: (p) => slowReplierDay60Email(p.full_name ?? 'there', siteUrl()),
  })

  // ── Day 85 nudge ─────────────────────────────────────────────
  await runOwnerNudge({
    dbAny, summary, kind: '85',
    minDaysInactive: 85, maxDaysInactive: 89,
    sentinel: 'slow_replier_nudge_85_sent',
    counter: 'nudge_85',
    template: (p) => slowReplierDay85Email(p.full_name ?? 'there', siteUrl()),
  })

  // ── Day 90+ flag flip ────────────────────────────────────────
  // Find owners inactive ≥90 days whose listings aren't flagged yet.
  const flaggedCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: stale, error: staleErr } = await dbAny
    .from('profiles')
    .select('id')
    .lt('last_login_at', flaggedCutoff)
    .limit(500) as { data: Array<{ id: string }> | null; error: { message: string } | null }
  if (staleErr) {
    console.error('[slow-replier] stale-owner query failed:', staleErr.message)
    summary.errors++
  } else if (stale?.length) {
    const { data: flipped, error: flipErr } = await dbAny
      .from('businesses')
      .update({ slow_replier: true })
      .in('owner_id', stale.map(p => p.id))
      .eq('slow_replier', false)
      .select('id') as { data: Array<{ id: string }> | null; error: { message: string } | null }
    if (flipErr) {
      console.error('[slow-replier] flag flip failed:', flipErr.message)
      summary.errors++
    } else {
      summary.flagged = flipped?.length ?? 0
    }
  }

  // ── Lazy clear: anyone <60 days inactive who's still flagged ─
  // This catches the case where a member logged back in but we haven't
  // cleared their flag. Eventually we'd do this on auth callback for
  // immediacy, but the lazy approach is correct enough for daily runs.
  const recentCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recent, error: recentErr } = await dbAny
    .from('profiles')
    .select('id')
    .gt('last_login_at', recentCutoff)
    .limit(500) as { data: Array<{ id: string }> | null; error: { message: string } | null }
  if (recentErr) {
    console.error('[slow-replier] recent-login query failed:', recentErr.message)
    summary.errors++
  } else if (recent?.length) {
    const { data: cleared, error: clearErr } = await dbAny
      .from('businesses')
      .update({ slow_replier: false })
      .in('owner_id', recent.map(p => p.id))
      .eq('slow_replier', true)
      .select('id') as { data: Array<{ id: string }> | null; error: { message: string } | null }
    if (clearErr) {
      console.error('[slow-replier] flag clear failed:', clearErr.message)
      summary.errors++
    } else {
      summary.cleared = cleared?.length ?? 0
    }
  }

  return NextResponse.json({ ok: true, ...summary })
}

async function runOwnerNudge(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbAny: any
  summary: { errors: number; nudge_60: number; nudge_85: number; flagged: number; cleared: number; [k: string]: number }
  kind: '60' | '85'
  minDaysInactive: number
  maxDaysInactive: number
  sentinel: string
  counter: 'nudge_60' | 'nudge_85'
  template: (p: OwnerRow) => { subject: string; html: string }
}) {
  const { dbAny, summary, sentinel, counter, template } = opts
  const minIso = new Date(Date.now() - opts.minDaysInactive * 24 * 60 * 60 * 1000).toISOString()
  const maxIso = new Date(Date.now() - opts.maxDaysInactive * 24 * 60 * 60 * 1000).toISOString()

  // Window owners inactive between [maxDaysInactive, minDaysInactive]
  // days. Need them to OWN at least one business (no point nudging
  // members with no listings — there's nothing to flag). Cap at 500.
  const { data: candidates, error } = await dbAny
    .from('profiles')
    .select('id, full_name, eo_membership_email, last_login_at, tenant_id')
    .lte('last_login_at', minIso)
    .gt('last_login_at', maxIso)
    .limit(500) as { data: OwnerRow[] | null; error: { message: string } | null }
  if (error) {
    console.error(`[slow-replier] day ${opts.kind} query failed:`, error.message)
    summary.errors++
    return
  }
  if (!candidates?.length) return

  const ids = candidates.map(c => c.id)
  // Filter to owners with at least one listing
  const { data: owners } = await dbAny
    .from('businesses')
    .select('owner_id')
    .in('owner_id', ids) as { data: Array<{ owner_id: string }> | null }
  const ownerIds = new Set((owners ?? []).map(o => o.owner_id))

  // Filter out anyone we've already nudged at this stage.
  const { data: alreadySent } = await dbAny
    .from('events_log')
    .select('member_id')
    .eq('type', sentinel)
    .in('member_id', ids) as { data: Array<{ member_id: string }> | null }
  const sentSet = new Set((alreadySent ?? []).map(r => r.member_id))

  for (const p of candidates) {
    if (!ownerIds.has(p.id)) continue
    if (sentSet.has(p.id)) continue
    if (!p.eo_membership_email) continue

    const tpl = template(p)
    const res = await sendEmail({ to: p.eo_membership_email, subject: tpl.subject, html: tpl.html })
    if (!res.ok) {
      console.error(`[slow-replier] day ${opts.kind} send to ${p.eo_membership_email} failed:`, res.error)
      summary.errors++
      continue
    }

    await dbAny.from('events_log').insert({
      type: sentinel,
      member_id: p.id,
      entity_id: null,
      metadata: { kind: opts.kind, days_inactive: opts.minDaysInactive },
      tenant_id: p.tenant_id,
    })
    summary[counter]++
  }
}
