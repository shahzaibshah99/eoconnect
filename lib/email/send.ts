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

// Brand logo for email headers.
//
// Why a hosted <img> rather than inline <svg>: Gmail (the dominant
// client our members read in) strips inline <svg> tags from HTML
// emails as part of its sanitisation pass. Outlook is unreliable
// for inline SVG too. PR #26 tried inline SVG and the result was
// no logo for most recipients — only the "Member Market" text in
// the footer copy survived.
//
// External <img> with absolute URL works in every major client.
// Gmail proxies the request through their image cache; Outlook
// fetches it directly; Apple Mail and Yahoo render it natively.
// The "click to load images" banner some clients show is harmless
// — once the user views one email through, the sender is allow-
// listed and subsequent emails render without the banner.
//
// We resolve the absolute URL from NEXT_PUBLIC_SITE_URL with a
// localhost dev fallback so previews still render in development.
function emailLogoTag(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') ||
    'https://app.member.market'
  return `<img src="${base}/email-logo.svg" width="190" height="36" alt="Member Market" style="display:block;border:0;outline:none;text-decoration:none;height:36px;width:190px;" />`
}

const wrap = (title: string, body: string) => `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9f6f0;">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
    <div style="margin-bottom:24px;">
      ${emailLogoTag()}
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

// ── Verification lifecycle ──────────────────────────────────
//
// Members move through: submit → admin reviews → approved | rejected |
// resubmit. Each transition fires a transactional email so the member
// has a record they can act on without logging in.

export function verificationSubmittedEmail(name: string, siteUrl: string) {
  return {
    subject: 'We got your verification submission',
    html: wrap('Verification submitted', `
      <h1 style="font-size:18px;margin:0 0 12px;">Thanks ${escapeHtml(name)}, we got your submission</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        An admin will review your screenshot and any supporting signals. Most submissions are reviewed within
        a few business days. We&apos;ll email you the moment your status changes.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard/verify" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          View status
        </a>
      </p>
    `)
  }
}

/**
 * Admin notification when a member submits a new verification.
 * Sent to every super_admin so somebody picks it up — the queue page
 * is the source of truth, this email is just a heads-up.
 */
export function verificationPendingAdminEmail(input: {
  memberName: string
  memberEmail: string | null
  memberChapter: string | null
  hasLinkedIn: boolean
  siteUrl: string
}) {
  const { memberName, memberEmail, memberChapter, hasLinkedIn, siteUrl } = input
  return {
    subject: `New verification submission: ${memberName}`,
    html: wrap('New verification awaiting review', `
      <h1 style="font-size:18px;margin:0 0 12px;">New verification needs review</h1>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
        <tr>
          <td style="padding:6px 8px;background:#fafafa;color:#666;width:120px;">Member</td>
          <td style="padding:6px 8px;background:#fafafa;"><strong>${escapeHtml(memberName)}</strong></td>
        </tr>
        ${memberEmail ? `<tr>
          <td style="padding:6px 8px;color:#666;">Email</td>
          <td style="padding:6px 8px;">${escapeHtml(memberEmail)}</td>
        </tr>` : ''}
        ${memberChapter ? `<tr>
          <td style="padding:6px 8px;background:#fafafa;color:#666;">Chapter</td>
          <td style="padding:6px 8px;background:#fafafa;">${escapeHtml(memberChapter)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:6px 8px;color:#666;">LinkedIn URL</td>
          <td style="padding:6px 8px;">${hasLinkedIn ? 'Provided · auto-scrape running' : 'Not provided'}</td>
        </tr>
      </table>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/admin/verifications" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Open verification queue
        </a>
      </p>
    `)
  }
}

export function verificationApprovedEmail(name: string, tagLabel: string, siteUrl: string) {
  return {
    subject: `You're verified — ${tagLabel}`,
    html: wrap('Verified', `
      <h1 style="font-size:18px;margin:0 0 12px;">${escapeHtml(name)}, you&apos;re verified</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        Your member profile now carries the <strong>${escapeHtml(tagLabel)}</strong> tag.
        Listings you publish inherit the tag and earn tier-based search ranking across the marketplace.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Go to dashboard
        </a>
      </p>
    `)
  }
}

export function verificationRejectedEmail(name: string, reason: string, siteUrl: string) {
  return {
    subject: 'Your verification needs another look',
    html: wrap('Verification rejected', `
      <h1 style="font-size:18px;margin:0 0 12px;">Hi ${escapeHtml(name)} — your submission wasn&apos;t approved</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;"><strong>Reason:</strong></p>
      <blockquote style="border-left:3px solid #B86800;padding:8px 16px;margin:8px 0 16px;background:#fdf3e3;font-size:14px;color:#333;">
        ${escapeHtml(reason)}
      </blockquote>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        You can submit again with updated info whenever you&apos;re ready.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard/verify" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Try again
        </a>
      </p>
    `)
  }
}

export function verificationResubmitEmail(name: string, note: string, siteUrl: string) {
  return {
    subject: 'Please resubmit your verification',
    html: wrap('Resubmission requested', `
      <h1 style="font-size:18px;margin:0 0 12px;">Hi ${escapeHtml(name)} — we need an updated submission</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;"><strong>What to update:</strong></p>
      <blockquote style="border-left:3px solid #1A3F6F;padding:8px 16px;margin:8px 0 16px;background:#e4edf8;font-size:14px;color:#333;">
        ${escapeHtml(note)}
      </blockquote>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        Make the change and submit again — your previous submission is on file.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard/verify" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Update submission
        </a>
      </p>
    `)
  }
}

// ── Verification grace period reminders ──────────────────────
//
// Per scope F01: members get nudged before their verification grace
// expires (14 days for member-initiated, 60 days for pre-populated).
// After expiry the listing stays live but ranks last — the reminders
// are the last chance to avoid that.

export function verificationReminderDay7Email(name: string, daysLeft: number, siteUrl: string) {
  return {
    subject: `Don't lose your member ranking — ${daysLeft} days to verify`,
    html: wrap('Verification reminder', `
      <h1 style="font-size:18px;margin:0 0 12px;">Hi ${escapeHtml(name)} — your verification is still pending</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        You haven&apos;t submitted a verification yet. Members who don&apos;t verify within 14 days drop to
        the bottom of search results, which means fewer eyes on your business.
      </p>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        It takes about 2 minutes — upload a screenshot of your member profile page and you&apos;re done.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard/verify" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Verify now
        </a>
      </p>
      <p style="font-size:12px;color:#888;margin-top:16px;">
        ${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your grace period.
      </p>
    `)
  }
}

export function verificationReminderFinalEmail(name: string, siteUrl: string) {
  return {
    subject: 'Final reminder — verify your membership tomorrow',
    html: wrap('Final verification reminder', `
      <h1 style="font-size:18px;margin:0 0 12px;">Last chance, ${escapeHtml(name)}</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        Your verification grace period ends tomorrow. After that, your listings stay live but drop to
        the bottom of search results until you&apos;re verified.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard/verify" style="background:#B86800;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Verify now
        </a>
      </p>
    `)
  }
}

export function verificationGraceExpiredEmail(name: string, siteUrl: string) {
  return {
    subject: 'Your verification grace period has ended',
    html: wrap('Grace period ended', `
      <h1 style="font-size:18px;margin:0 0 12px;">Hi ${escapeHtml(name)} — your grace period has ended</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        Your listings are still live, but they now rank below all verified members in search.
        You can still verify any time to restore your ranking.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard/verify" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Verify now
        </a>
      </p>
    `)
  }
}

export function claimReminderEmail(name: string, businessName: string, daysLeft: number, claimUrl: string) {
  return {
    subject: `Claim your Member Market profile — ${businessName}`,
    html: wrap('Claim your profile', `
      <h1 style="font-size:18px;margin:0 0 12px;">Hi ${escapeHtml(name)} — your profile is waiting</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        We&apos;ve pre-populated a Member Market listing for <strong>${escapeHtml(businessName)}</strong>.
        Claim it to take ownership, edit the details, and start receiving inquiries from fellow EO members.
      </p>
      <p style="margin-top:20px;">
        <a href="${claimUrl}" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Claim your profile
        </a>
      </p>
      <p style="font-size:12px;color:#888;margin-top:16px;">
        ${daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to claim.` : 'Claim window has expired but your listing remains live.'}
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
