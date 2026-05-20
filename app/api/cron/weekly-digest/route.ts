import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail, weeklyDigestEmail } from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'
import { createHash } from 'crypto'

/**
 * F12: Weekly digest email.
 *
 * Per scope: Monday 8am UTC. Suppressed if:
 *   - Member logged in within 24hrs
 *   - No new relevant activity (no new listings or needs)
 *   - Member unsubscribed (events_log type='digest_unsubscribed')
 *
 * Content:
 *   - New verified listings this week (global — category matching is
 *     a future personalisation step; for now show any new listings)
 *   - Open bulletin needs (both boards) from the past 7 days
 *   - Profile views this week (from listing_analytics)
 *
 * Idempotency: sentinel event 'weekly_digest_sent' keyed by member_id
 * + week ISO string so running twice in a week is a no-op.
 */

export const maxDuration = 120

function weekKey() {
  const d = new Date()
  const week = Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000))
  return `week-${week}`
}

function digestToken(memberId: string): string {
  const secret = process.env.CRON_SECRET ?? 'digest'
  return createHash('sha256').update(`${memberId}:${secret}`).digest('hex').slice(0, 32)
}

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

  const week = weekKey()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const site = siteUrl()

  // New verified listings this week
  const { data: newListings } = await dbAny
    .from('businesses')
    .select('id, name, category_ids, categories:categories!inner(name)')
    .eq('status', 'published')
    .neq('verification_tag', 'unverified')
    .gte('created_at', sevenDaysAgo)
    .limit(5) as {
    data: Array<{ id: string; name: string; category_ids: string[] | null }> | null
  }

  // Open needs from the past 7 days (both boards)
  const { data: openNeeds } = await dbAny
    .from('bulletin_posts')
    .select('id, title, board_type')
    .eq('status', 'open')
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(5) as {
    data: Array<{ id: string; title: string; board_type: 'business' | 'community' }> | null
  }

  const hasGlobalActivity = (newListings?.length ?? 0) > 0 || (openNeeds?.length ?? 0) > 0

  // Pull active verified members with emails
  const { data: members } = await dbAny
    .from('profiles')
    .select('id, full_name, eo_membership_email, verification_tag')
    .neq('verification_tag', 'unverified')
    .not('eo_membership_email', 'is', null)
    .limit(2000) as {
    data: Array<{ id: string; full_name: string | null; eo_membership_email: string; verification_tag: string }> | null
  }

  // Fetch already-sent sentinels for this week and unsubscribes
  const memberIds = (members ?? []).map(m => m.id)
  const [{ data: alreadySent }, { data: unsubscribed }] = await Promise.all([
    dbAny.from('events_log').select('member_id').eq('type', 'weekly_digest_sent').eq('metadata->>week', week).in('member_id', memberIds) as Promise<{ data: Array<{ member_id: string }> | null }>,
    dbAny.from('events_log').select('member_id').eq('type', 'digest_unsubscribed').in('member_id', memberIds) as Promise<{ data: Array<{ member_id: string }> | null }>,
  ])

  const sentSet = new Set((alreadySent ?? []).map(r => r.member_id))
  const unsubSet = new Set((unsubscribed ?? []).map(r => r.member_id))
  const listingsFormatted = (newListings ?? []).map(l => ({ name: l.name, category: 'Business', id: l.id }))

  // Pre-fetch analytics for all members' businesses in one pass to avoid N+1 queries.
  // Build a map of owner_id → total views this week.
  const viewsByOwner = new Map<string, number>()
  if (memberIds.length > 0) {
    const { data: bizRows } = await dbAny
      .from('businesses')
      .select('id, owner_id')
      .in('owner_id', memberIds) as { data: Array<{ id: string; owner_id: string }> | null }
    const bizIdToOwner = new Map((bizRows ?? []).map(b => [b.id, b.owner_id]))
    if (bizIdToOwner.size > 0) {
      const { data: analyticsRows } = await dbAny
        .from('listing_analytics')
        .select('business_id, views')
        .in('business_id', Array.from(bizIdToOwner.keys()))
        .gte('date', sevenDaysAgo.split('T')[0]) as { data: Array<{ business_id: string; views: number }> | null }
      for (const row of analyticsRows ?? []) {
        const ownerId = bizIdToOwner.get(row.business_id)
        if (ownerId) viewsByOwner.set(ownerId, (viewsByOwner.get(ownerId) ?? 0) + (row.views ?? 0))
      }
    }
  }

  const summary = { sent: 0, skipped_no_activity: 0, skipped_already_sent: 0, skipped_unsub: 0, errors: 0 }

  for (const member of members ?? []) {
    if (unsubSet.has(member.id)) { summary.skipped_unsub++; continue }
    if (sentSet.has(member.id)) { summary.skipped_already_sent++; continue }
    if (!hasGlobalActivity) { summary.skipped_no_activity++; continue }

    const profileViews = viewsByOwner.get(member.id) ?? 0

    const tpl = weeklyDigestEmail({
      memberName: member.full_name ?? 'there',
      newListingsCount: newListings?.length ?? 0,
      newListings: listingsFormatted,
      openNeedsCount: openNeeds?.length ?? 0,
      openNeeds: openNeeds ?? [],
      profileViews,
      siteUrl: site,
      unsubscribeToken: digestToken(member.id),
    })

    if (!tpl) { summary.skipped_no_activity++; continue }

    const res = await sendEmail({ to: member.eo_membership_email, subject: tpl.subject, html: tpl.html })
    if (!res.ok) {
      console.error(`[weekly-digest] send to ${member.eo_membership_email} failed:`, res.error)
      summary.errors++
      continue
    }

    await dbAny.from('events_log').insert({
      type: 'weekly_digest_sent',
      member_id: member.id,
      metadata: { week, new_listings: newListings?.length ?? 0, open_needs: openNeeds?.length ?? 0 },
      tenant_id: 'eo',
    })
    summary.sent++
  }

  return NextResponse.json({ ok: true, ...summary })
}
