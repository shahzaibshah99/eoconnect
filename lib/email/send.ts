import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'

/**
 * Transactional email — sends through Hostinger SMTP via nodemailer.
 *
 * Required env vars:
 *   SMTP_HOST      smtp.hostinger.com
 *   SMTP_PORT      465 (SSL/TLS, recommended) or 587 (STARTTLS)
 *   SMTP_USER      full mailbox address — accounts@member.market
 *   SMTP_PASS      mailbox password set in Hostinger control panel
 *   EMAIL_FROM     "Member Market <accounts@member.market>"
 *
 * If SMTP_HOST is missing the call no-ops with a warning so local dev
 * doesn't crash on missing config (matches the previous Resend behavior).
 *
 * Note: Supabase auth emails (sign-up confirm, password reset, magic link)
 * are NOT routed through this function. Configure those in
 *   Supabase dashboard → Project Settings → Auth → SMTP Settings
 * pointing at password@member.market.
 */

let _transport: Transporter | null = null

function getTransport(): Transporter | null {
  if (_transport) return _transport
  const host = process.env.SMTP_HOST
  if (!host) return null

  const port = Number(process.env.SMTP_PORT ?? 465)
  _transport = nodemailer.createTransport({
    host,
    port,
    // Hostinger: port 465 = implicit TLS, port 587 = STARTTLS.
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
  return _transport
}

const FROM = process.env.EMAIL_FROM ?? 'Member Market <accounts@member.market>'

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  /** Optional Reply-To header — used for support inquiries so the
   *  support team can reply directly to the member without going
   *  through the from-address (which is the platform mailbox). */
  replyTo?: string
}): Promise<{ ok: boolean; error?: string }> {
  const t = getTransport()
  if (!t) {
    console.warn(`[email] skipped — SMTP_HOST not configured (would send "${opts.subject}" to ${opts.to})`)
    return { ok: false, error: 'SMTP not configured' }
  }
  try {
    await t.sendMail({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      replyTo: opts.replyTo,
    })
    return { ok: true }
  } catch (err) {
    console.error('[email] send failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

// ── Templates ─────────────────────────────────────────────────

// Brand logo for email headers — inline SVG so it renders without
// hitting external image hosts (avoids the "click to load images"
// banner in Gmail/Outlook). The wordmark text is part of the SVG so
// the brand still reads cleanly even if a client strips inline SVG;
// in that case the surrounding email body still names "Member Market"
// in the footer copy below.
const EMAIL_LOGO_SVG = `<svg width="190" height="36" viewBox="0 0 380 72" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Member Market" style="display:block;">
  <g transform="translate(4, 4)">
    <rect width="64" height="64" rx="12" fill="#0A2218"/>
    <rect x="12" y="20" width="7" height="28" rx="2" fill="#D4821A"/>
    <rect x="12" y="20" width="18" height="8" rx="2" fill="#D4821A"/>
    <rect x="23" y="20" width="7" height="28" rx="2" fill="#D4821A"/>
    <rect x="23" y="20" width="18" height="8" rx="2" fill="#D4821A"/>
    <rect x="34" y="20" width="7" height="28" rx="2" fill="#D4821A"/>
    <rect x="45" y="20" width="7" height="28" rx="2" fill="#D4821A"/>
  </g>
  <text x="84" y="48"
        font-family="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
        font-size="32"
        font-weight="700"
        fill="#0A2218">member<tspan fill="#D4821A">.market</tspan></text>
</svg>`

const wrap = (title: string, body: string) => `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9f6f0;">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
    <div style="margin-bottom:24px;">
      ${EMAIL_LOGO_SVG}
    </div>
    ${body}
    <p style="font-size:12px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">
      You received this because you're a member of Member Market — There's A Business For That.
    </p>
  </div>
</body></html>`

export function welcomeEmail(name: string, siteUrl: string) {
  return wrap('Welcome to Member Market', `
    <h1 style="font-size:20px;margin:0 0 12px;">Welcome to Member Market, ${escapeHtml(name)}!</h1>
    <p style="font-size:15px;line-height:1.5;color:#444;">
      You now have access to the EO members' marketplace. Browse trusted businesses run by fellow members,
      send inquiries, and post your own services to reach the network.
    </p>
    <p style="margin-top:24px;">
      <a href="${siteUrl}/marketplace" style="background:#0A2218;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
        Browse the marketplace
      </a>
    </p>
  `)
}

export function newMessageEmail(senderName: string, businessName: string | null, preview: string, siteUrl: string, conversationId: string) {
  const subject = businessName ? `New inquiry about ${businessName}` : `New message from ${senderName}`
  return {
    subject,
    html: wrap(subject, `
      <h1 style="font-size:18px;margin:0 0 12px;">${escapeHtml(senderName)} sent you a message</h1>
      ${businessName ? `<p style="color:#666;font-size:13px;margin:0 0 12px;">re: ${escapeHtml(businessName)}</p>` : ''}
      <blockquote style="border-left:3px solid #0A2218;padding:8px 16px;margin:16px 0;background:#fafafa;font-size:14px;color:#333;">
        ${escapeHtml(preview)}
      </blockquote>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard/messages?conversation=${conversationId}" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Reply
        </a>
      </p>
    `)
  }
}

export function newReviewEmail(reviewerName: string, businessName: string, rating: number, body: string | null, siteUrl: string, businessId: string) {
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating)
  return {
    subject: `${reviewerName} left you a ${rating}-star review`,
    html: wrap('New review', `
      <h1 style="font-size:18px;margin:0 0 8px;">${escapeHtml(reviewerName)} reviewed ${escapeHtml(businessName)}</h1>
      <p style="font-size:18px;color:#0A2218;margin:0 0 16px;letter-spacing:2px;">${stars}</p>
      ${body ? `<blockquote style="border-left:3px solid #ddd;padding:8px 16px;margin:16px 0;background:#fafafa;font-size:14px;color:#333;">${escapeHtml(body)}</blockquote>` : ''}
      <p style="margin-top:20px;">
        <a href="${siteUrl}/marketplace/${businessId}" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          View &amp; reply
        </a>
      </p>
    `)
  }
}

export function adApprovedEmail(businessName: string, siteUrl: string, campaignId: string) {
  return {
    subject: `Your Member Market campaign is live`,
    html: wrap('Campaign live', `
      <h1 style="font-size:18px;margin:0 0 12px;">Your campaign for ${escapeHtml(businessName)} is now live</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        Members searching for relevant services will start seeing your sponsored listing.
        Check back to see how it's performing.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard/ads/${campaignId}" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          View campaign
        </a>
      </p>
    `)
  }
}

export function adRejectedEmail(businessName: string, reason: string, siteUrl: string, campaignId: string) {
  return {
    subject: `Your Member Market campaign needs changes`,
    html: wrap('Campaign rejected', `
      <h1 style="font-size:18px;margin:0 0 12px;">Your campaign for ${escapeHtml(businessName)} wasn't approved</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        You can edit and resubmit your campaign — your budget is still on file.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard/ads/${campaignId}" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Edit campaign
        </a>
      </p>
    `)
  }
}

/**
 * Support inquiry from a signed-in member. Goes to support@member.market.
 * Always includes a member-context block (id / name / email / chapter) so
 * the support team can see who's asking without a separate lookup.
 *
 * The from-address is left as the platform default (accounts@member.market)
 * because Hostinger rejects sends from addresses that aren't authenticated
 * by SMTP_USER. The member's email is surfaced in the HTML body and added
 * to Reply-To by the caller, so replying lands in their inbox naturally.
 */
export function supportInquiryEmail(input: {
  member: { id: string; full_name: string; email: string | null; chapter: string | null }
  subject: string
  body: string
}) {
  const { member, subject, body } = input
  const safeBody = escapeHtml(body).replace(/\n/g, '<br>')
  const subjectLine = `Support inquiry from ${member.full_name || 'member'}: ${subject}`

  return {
    subject: subjectLine,
    html: wrap('Support inquiry', `
      <h1 style="font-size:18px;margin:0 0 12px;">New support inquiry</h1>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
        <tr>
          <td style="padding:6px 8px;background:#fafafa;color:#666;width:120px;">Member</td>
          <td style="padding:6px 8px;background:#fafafa;"><strong>${escapeHtml(member.full_name || '—')}</strong></td>
        </tr>
        <tr>
          <td style="padding:6px 8px;color:#666;">User ID</td>
          <td style="padding:6px 8px;"><code style="font-size:12px;">${escapeHtml(member.id)}</code></td>
        </tr>
        <tr>
          <td style="padding:6px 8px;background:#fafafa;color:#666;">Email</td>
          <td style="padding:6px 8px;background:#fafafa;">${member.email ? `<a href="mailto:${escapeHtml(member.email)}">${escapeHtml(member.email)}</a>` : '—'}</td>
        </tr>
        <tr>
          <td style="padding:6px 8px;color:#666;">EO Chapter</td>
          <td style="padding:6px 8px;">${escapeHtml(member.chapter || '—')}</td>
        </tr>
      </table>
      <h2 style="font-size:15px;margin:24px 0 6px;">${escapeHtml(subject)}</h2>
      <blockquote style="border-left:3px solid #0A2218;padding:12px 16px;margin:8px 0 0;background:#fafafa;font-size:14px;color:#333;line-height:1.5;">
        ${safeBody}
      </blockquote>
    `)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
