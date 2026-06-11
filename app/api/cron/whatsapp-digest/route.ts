import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'

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
    return NextResponse.json({ ok: false }, { status: 503 })
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: classificationRows } = await dbAny
    .from('whatsapp_classification_log')
    .select('intent, dropped')
    .gte('created_at', since) as {
      data: Array<{ intent: string; dropped: boolean }> | null
    }

  const counts: Record<string, number> = { total: 0, need: 0, lead: 0, noise: 0, posts_created: 0 }
  for (const row of classificationRows ?? []) {
    counts.total++
    if (row.intent in counts) counts[row.intent]++
    if (!row.dropped) counts.posts_created++
  }

  if (counts.total === 0) {
    return NextResponse.json({ ok: true, skipped: 'no_activity' })
  }

  // Recipients: super_admins or override env var
  const overrideEmail = process.env.WHATSAPP_DIGEST_EMAIL
  let recipients: Array<{ eo_membership_email: string; full_name: string }> = []

  if (overrideEmail) {
    recipients = [{ eo_membership_email: overrideEmail, full_name: 'Admin' }]
  } else {
    const { data: admins } = await dbAny
      .from('profiles')
      .select('eo_membership_email, full_name')
      .eq('role', 'super_admin')
      .not('eo_membership_email', 'is', null) as {
        data: Array<{ eo_membership_email: string; full_name: string }> | null
      }
    recipients = admins ?? []
  }

  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'no_recipients' })
  }

  const site = siteUrl()
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9f6f0;">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
    <h1 style="font-size:18px;margin:0 0 16px;">WhatsApp Activity — last 24 hours</h1>
    <table style="border-collapse:collapse;font-size:14px;width:100%;">
      <tr><td style="padding:6px 16px 6px 0;color:#666;">Total messages</td><td style="font-weight:600;">${counts.total}</td></tr>
      <tr><td style="padding:6px 16px 6px 0;color:#666;">Needs detected</td><td>${counts.need}</td></tr>
      <tr><td style="padding:6px 16px 6px 0;color:#666;">Leads detected</td><td>${counts.lead}</td></tr>
      <tr><td style="padding:6px 16px 6px 0;color:#666;">Noise / dropped</td><td>${counts.noise}</td></tr>
      <tr><td style="padding:6px 16px 6px 0;color:#666;">Posts created</td><td style="font-weight:600;">${counts.posts_created}</td></tr>
    </table>
    <p style="margin-top:24px;">
      <a href="${site}/admin/whatsapp" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
        View WhatsApp admin panel
      </a>
    </p>
  </div>
</body></html>`

  let sent = 0
  for (const admin of recipients) {
    await sendEmail({
      to: admin.eo_membership_email,
      subject: `WhatsApp digest: ${counts.posts_created} posts from ${counts.total} messages`,
      html,
    })
    sent++
  }

  return NextResponse.json({ ok: true, sent, counts })
}
