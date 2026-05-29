import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  sendEmail,
  verificationReminderDay7Email,
  verificationReminderFinalEmail,
  verificationGraceExpiredEmail,
  claimReminderEmail,
} from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'

/**
 * Verification grace-period reminders.
 *
 * Per scope F01:
 *   Member-initiated grace period: 14 days from profiles.created_at.
 *     - day 7  → "still pending" reminder
 *     - day 13 → final reminder ("expires tomorrow")
 *     - day 14 → grace-expired notice
 *
 *   Pre-populated cold-invite claim window: 60 days from
 *   businesses.claim_email_sent_at.
 *     - day 1  → first reminder (initial claim email already went out at populate time)
 *     - day 7  → second reminder
 *     - day 30 → final reminder
 *     - day 60 → claim window closed (listing stays live, ranks last)
 *
 * Idempotency: each reminder type writes a sentinel row to events_log
 * keyed by (member_id, type). The cron's WHERE clauses include a
 * NOT EXISTS check against that sentinel so re-running is a no-op.
 *
 * Schedule: daily at 09:13 UTC (see vercel.json). Time-of-day chosen
 * to dodge the top of every hour where cron services back up.
 *
 * Auth: Vercel auto-injects `Authorization: Bearer $CRON_SECRET`. We
 * accept that or a missing CRON_SECRET (dev convenience).
 */

export const maxDuration = 120

type Profile = {
  id: string
  full_name: string | null
  eo_membership_email: string | null
  verification_tag: string
  tenant_id: string
  created_at: string
}

type Business = {
  id: string
  name: string
  owner_id: string
  is_pre_populated: boolean
  claim_email_sent_at: string | null
  claim_token: string | null
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
    member_day7: 0,
    member_final: 0,
    member_expired: 0,
    claim_day3: 0,
    claim_day7: 0,
    claim_day14: 0,
    claim_day21: 0,
    claim_day35: 0,
    claim_day50: 0,
    claim_day59: 0,
    errors: 0,
  }

  // ── Member-initiated reminders ──────────────────────────────
  await runMemberStage({
    dbAny, summary, kind: 'day7',
    minDaysAgo: 7, maxDaysAgo: 13,
    sentinel: 'verification_reminder_day7_sent',
    counter: 'member_day7',
    template: (p) => verificationReminderDay7Email(p.full_name ?? 'there', daysUntil(p.created_at, 14), siteUrl()),
  })
  await runMemberStage({
    dbAny, summary, kind: 'final',
    minDaysAgo: 13, maxDaysAgo: 14,
    sentinel: 'verification_reminder_final_sent',
    counter: 'member_final',
    template: (p) => verificationReminderFinalEmail(p.full_name ?? 'there', siteUrl()),
  })
  await runMemberStage({
    dbAny, summary, kind: 'expired',
    minDaysAgo: 14, maxDaysAgo: null,
    sentinel: 'verification_grace_expired_sent',
    counter: 'member_expired',
    template: (p) => verificationGraceExpiredEmail(p.full_name ?? 'there', siteUrl()),
  })

  // ── Pre-populated claim reminders ───────────────────────────
  // Runs daily. Each stage fires once per listing (sentinel in events_log
  // keeps re-runs idempotent). Windows are non-overlapping so a listing
  // only gets one email per stage even if the cron runs multiple times.
  await runClaimStage({ dbAny, summary, kind: 'day3',  minDaysAgo: 3,  maxDaysAgo: 7,  sentinel: 'claim_reminder_day3_sent',  counter: 'claim_day3'  })
  await runClaimStage({ dbAny, summary, kind: 'day7',  minDaysAgo: 7,  maxDaysAgo: 14, sentinel: 'claim_reminder_day7_sent',  counter: 'claim_day7'  })
  await runClaimStage({ dbAny, summary, kind: 'day14', minDaysAgo: 14, maxDaysAgo: 21, sentinel: 'claim_reminder_day14_sent', counter: 'claim_day14' })
  await runClaimStage({ dbAny, summary, kind: 'day21', minDaysAgo: 21, maxDaysAgo: 35, sentinel: 'claim_reminder_day21_sent', counter: 'claim_day21' })
  await runClaimStage({ dbAny, summary, kind: 'day35', minDaysAgo: 35, maxDaysAgo: 50, sentinel: 'claim_reminder_day35_sent', counter: 'claim_day35' })
  await runClaimStage({ dbAny, summary, kind: 'day50', minDaysAgo: 50, maxDaysAgo: 59, sentinel: 'claim_reminder_day50_sent', counter: 'claim_day50' })
  await runClaimStage({ dbAny, summary, kind: 'day59', minDaysAgo: 59, maxDaysAgo: 60, sentinel: 'claim_reminder_day59_sent', counter: 'claim_day59' })

  return NextResponse.json({ ok: true, ...summary })
}

// ── Stage runners ─────────────────────────────────────────────

async function runMemberStage(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbAny: any
  summary: { errors: number; member_day7: number; member_final: number; member_expired: number; [k: string]: number }
  kind: 'day7' | 'final' | 'expired'
  minDaysAgo: number
  maxDaysAgo: number | null
  sentinel: string
  counter: 'member_day7' | 'member_final' | 'member_expired'
  template: (p: Profile) => { subject: string; html: string }
}) {
  const { dbAny, summary, sentinel, counter, template } = opts
  const minIso = new Date(Date.now() - opts.minDaysAgo * 24 * 60 * 60 * 1000).toISOString()
  const maxIso = opts.maxDaysAgo === null
    ? null
    : new Date(Date.now() - opts.maxDaysAgo * 24 * 60 * 60 * 1000).toISOString()

  // Pull candidates: unverified, in the window. Cap at 500 per stage so a
  // surprise backfill doesn't blow the function timeout.
  let q = dbAny
    .from('profiles')
    .select('id, full_name, eo_membership_email, verification_tag, tenant_id, created_at')
    .eq('verification_tag', 'unverified')
    .lte('created_at', minIso)
    .limit(500)
  if (maxIso) q = q.gt('created_at', maxIso)

  const { data: profiles, error } = await q as { data: Profile[] | null; error: { message: string } | null }
  if (error) {
    console.error(`[verification-reminders] member ${opts.kind} query failed:`, error.message)
    summary.errors++
    return
  }
  if (!profiles?.length) return

  // Filter out anyone we've already sent this reminder to.
  const ids = profiles.map(p => p.id)
  const { data: alreadySent } = await dbAny
    .from('events_log')
    .select('member_id')
    .eq('type', sentinel)
    .in('member_id', ids) as { data: Array<{ member_id: string }> | null }
  const sentSet = new Set((alreadySent ?? []).map(r => r.member_id))

  for (const p of profiles) {
    if (sentSet.has(p.id)) continue
    if (!p.eo_membership_email) continue

    const tpl = template(p)
    const res = await sendEmail({ to: p.eo_membership_email, subject: tpl.subject, html: tpl.html })
    if (!res.ok) {
      console.error(`[verification-reminders] send to ${p.eo_membership_email} failed:`, res.error)
      summary.errors++
      continue
    }

    // Sentinel row — keeps re-runs idempotent.
    await dbAny.from('events_log').insert({
      type: sentinel,
      member_id: p.id,
      entity_id: null,
      metadata: { kind: opts.kind, days_since_signup: opts.minDaysAgo },
      tenant_id: p.tenant_id,
    })
    summary[counter]++
  }
}

async function runClaimStage(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbAny: any
  summary: { errors: number; [k: string]: number }
  kind: string
  minDaysAgo: number
  maxDaysAgo: number
  sentinel: string
  counter: string
}) {
  const { dbAny, summary, sentinel, counter } = opts
  const minIso = new Date(Date.now() - opts.minDaysAgo * 24 * 60 * 60 * 1000).toISOString()
  const maxIso = new Date(Date.now() - opts.maxDaysAgo * 24 * 60 * 60 * 1000).toISOString()

  const { data: businesses, error } = await dbAny
    .from('businesses')
    .select('id, name, owner_id, is_pre_populated, claim_email_sent_at, claim_token, tenant_id')
    .eq('is_pre_populated', true)
    .lte('claim_email_sent_at', minIso)
    .gt('claim_email_sent_at', maxIso)
    .limit(500) as { data: Business[] | null; error: { message: string } | null }
  if (error) {
    console.error(`[verification-reminders] claim ${opts.kind} query failed:`, error.message)
    summary.errors++
    return
  }
  if (!businesses?.length) return

  const ids = businesses.map(b => b.id)
  const { data: alreadySent } = await dbAny
    .from('events_log')
    .select('entity_id')
    .eq('type', sentinel)
    .in('entity_id', ids) as { data: Array<{ entity_id: string }> | null }
  const sentSet = new Set((alreadySent ?? []).map(r => r.entity_id))

  // Pull owner profiles in bulk for the email merge fields.
  const ownerIds = businesses.map(b => b.owner_id)
  const { data: owners } = await dbAny
    .from('profiles')
    .select('id, full_name, eo_membership_email')
    .in('id', ownerIds) as { data: Array<{ id: string; full_name: string | null; eo_membership_email: string | null }> | null }
  const ownerMap = new Map((owners ?? []).map(o => [o.id, o]))

  for (const b of businesses) {
    if (sentSet.has(b.id)) continue
    const owner = ownerMap.get(b.owner_id)
    if (!owner?.eo_membership_email) continue
    if (!b.claim_email_sent_at) continue

    const daysSince = Math.floor((Date.now() - new Date(b.claim_email_sent_at).getTime()) / (24 * 60 * 60 * 1000))
    const daysLeft = Math.max(0, 60 - daysSince)
    const claimUrl = b.claim_token
      ? `${siteUrl()}/claim/${b.claim_token}`
      : `${siteUrl()}/dashboard/verify`

    const tpl = claimReminderEmail({ name: owner.full_name ?? 'there', businessName: b.name, daysLeft, claimUrl })
    const res = await sendEmail({ to: owner.eo_membership_email, subject: tpl.subject, html: tpl.html })
    if (!res.ok) {
      console.error(`[verification-reminders] claim send to ${owner.eo_membership_email} failed:`, res.error)
      summary.errors++
      continue
    }

    await dbAny.from('events_log').insert({
      type: sentinel,
      member_id: owner.id,
      entity_id: b.id,
      metadata: { kind: opts.kind, business_name: b.name },
      tenant_id: b.tenant_id,
    })
    summary[counter]++
  }
}

function daysUntil(createdAtIso: string, totalDays: number): number {
  const elapsed = (Date.now() - new Date(createdAtIso).getTime()) / (24 * 60 * 60 * 1000)
  return Math.max(0, Math.ceil(totalDays - elapsed))
}
