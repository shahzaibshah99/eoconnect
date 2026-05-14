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
  replyTo?: string
}): Promise<{ ok: boolean; error?: string }> {
  const t = getTransport()
  if (!t) {
    console.warn(`[email] skipped — SMTP_HOST not configured (would send "${opts.subject}" to ${opts.to})`)
    void logEmailEvent({ to: opts.to, subject: opts.subject, status: 'skipped', error: 'SMTP not configured' })
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
    void logEmailEvent({ to: opts.to, subject: opts.subject, status: 'sent' })
    return { ok: true }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'unknown'
    console.error('[email] send failed:', err)
    void logEmailEvent({ to: opts.to, subject: opts.subject, status: 'failed', error: errorMsg })
    return { ok: false, error: errorMsg }
  }
}

async function logEmailEvent(data: {
  to: string
  subject: string
  status: 'sent' | 'failed' | 'skipped'
  error?: string
}) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return
    const { createClient } = await import('@supabase/supabase-js')
    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    )
    await svc.from('events_log').insert({
      type: 'email_sent',
      metadata: {
        to: data.to,
        subject: data.subject,
        status: data.status,
        error: data.error ?? null,
      },
      tenant_id: 'eo',
    })
  } catch {
    // Never let logging crash the email send path
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

// Slow-replier nudges: sent before the member trips the 90-day flag.
//
// Per F02: at 60 and 85 days no login the member is emailed asking
// them to pop in. At 90, the slow_replier flag flips and their listings
// render greyed in search until they log in again.

export function slowReplierDay60Email(name: string, siteUrl: string) {
  return {
    subject: 'Your listings miss you',
    html: wrap('Come back soon', `
      <h1 style="font-size:18px;margin:0 0 12px;">Hey ${escapeHtml(name)} — it&apos;s been a while</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        You haven&apos;t logged in for 60 days. Just a friendly nudge so you don&apos;t miss any inquiries.
        At 90 days inactive your listings get marked as &ldquo;slow replier&rdquo; in search — easily
        avoided with a single login.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Open dashboard
        </a>
      </p>
    `)
  }
}

export function slowReplierDay85Email(name: string, siteUrl: string) {
  return {
    subject: '5 days until your listings are flagged',
    html: wrap('Slow replier flag in 5 days', `
      <h1 style="font-size:18px;margin:0 0 12px;">${escapeHtml(name)} — last call before the slow-replier flag</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        You&apos;re 85 days into your inactive window. In 5 days your listings will start rendering greyed
        in search results with a &ldquo;slow replier&rdquo; label.
      </p>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        One login clears the flag instantly.
      </p>
      <p style="margin-top:20px;">
        <a href="${siteUrl}/dashboard" style="background:#B86800;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Log in now
        </a>
      </p>
    `)
  }
}

/**
 * Claim email triggered by an inquiry on an unclaimed pre-populated
 * listing. Per scope F03: "Someone just enquired about your business
 * on Member Market — claim your profile to respond."
 */
export function inquiryClaimEmail(input: {
  businessName: string
  inquirerName: string
  inquiryPreview: string
  claimUrl: string
}) {
  const { businessName, inquirerName, inquiryPreview, claimUrl } = input
  return {
    subject: `Someone just enquired about ${businessName}`,
    html: wrap('New inquiry — claim to respond', `
      <h1 style="font-size:18px;margin:0 0 12px;">${escapeHtml(inquirerName)} just enquired about ${escapeHtml(businessName)}</h1>
      <p style="font-size:14px;color:#444;line-height:1.5;">
        Your business is listed on Member Market but hasn&apos;t been claimed yet. A fellow EO member just sent
        an inquiry — claim your profile to read the message and reply.
      </p>
      <blockquote style="border-left:3px solid #0A2218;padding:8px 16px;margin:16px 0;background:#fafafa;font-size:14px;color:#333;">
        ${escapeHtml(inquiryPreview)}
      </blockquote>
      <p style="margin-top:20px;">
        <a href="${claimUrl}" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Claim &amp; respond
        </a>
      </p>
      <p style="font-size:12px;color:#888;margin-top:16px;">
        Once you claim, you&apos;ll see all inquiries in your dashboard.
      </p>
    `)
  }
}

export function claimReminderEmail(input: {
  name: string
  businessName: string
  businessUrl?: string | null
  daysLeft: number
  claimUrl: string
  removeUrl?: string
}) {
  const { name, businessName, businessUrl, daysLeft, claimUrl, removeUrl } = input
  const safeName = escapeHtml(name)
  const safeBizName = escapeHtml(businessName)
  const safeBizUrl = businessUrl ? escapeHtml(businessUrl) : ''
  const subject = `We've reserved a Member Market listing for ${safeBizName}`

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${safeBizName} — Member Market listing reserved</title>
  <!--[if mso]>
  <xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  <![endif]-->
  <style type="text/css">
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
    img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}
    body{margin:0!important;padding:0!important;width:100%!important}
    @media screen and (max-width:600px){
      .email-card{width:100%!important;border-radius:0!important}
      .email-body{padding:28px 24px!important}
      .email-footer{padding:18px 24px!important}
      .email-header{padding:20px 24px!important}
      .feature-grid-cell{display:block!important;width:100%!important}
      .feature-grid-spacer{display:none!important}
      h2.headline{font-size:22px!important;line-height:30px!important}
      .cta-btn{display:block!important;text-align:center!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#EDE9E3;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your EO member listing is live and waiting — claim it to get found by fellow entrepreneurs.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#EDE9E3;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" class="email-card" border="0" cellpadding="0" cellspacing="0" width="580" style="max-width:580px;width:100%;background-color:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.09);">

        <!-- HEADER -->
        <tr>
          <td class="email-header" style="background-color:#0A5C46;padding:22px 36px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="vertical-align:middle;">
                  <span style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:normal;color:#ffffff;vertical-align:middle;letter-spacing:-0.3px;">Member Market</span>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:0.08em;background-color:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);padding:5px 11px;border-radius:20px;white-space:nowrap;">EO Members Only</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td class="email-body" style="padding:36px;">
            <h2 class="headline" style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:normal;color:#111111;line-height:1.2;margin:0 0 18px 0;">We've created a listing<br />for your business.</h2>
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.75;margin:0 0 14px 0;">Hi ${safeName},</p>
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.75;margin:0 0 14px 0;"><strong style="color:#111111;">Member Market is a private, verified business directory built exclusively for EO members, by EO members</strong> — a place to be found by fellow entrepreneurs who need what you offer, and to find businesses you can trust when you need them.</p>
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.75;margin:0 0 14px 0;">It's also an ideal home for your needs and leads, curated by our AI concierge.</p>
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.75;margin:0 0 20px 0;">We've identified you as an EO member and created a listing for <strong style="color:#111111;">${safeBizName}</strong>. It's live now — but it's waiting for you to claim it, verify your membership, and make it your own.</p>

            <!-- LISTING CARD -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border:1.5px solid #E2E2E2;border-radius:10px;overflow:hidden;margin:0 0 22px 0;">
              <tr>
                <td style="background-color:#0A5C46;padding:10px 18px;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:rgba(255,255,255,0.65);font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;">Your listing on Member Market</td>
                      <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:rgba(255,255,255,0.9);font-weight:bold;">&#9679;&nbsp;Awaiting claim</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:18px;background-color:#ffffff;">
                  <p style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#111111;margin:0 0 4px 0;">${safeBizName}</p>
                  ${safeBizUrl ? `<p style="font-family:'Courier New',Courier,monospace;font-size:11px;color:#888888;margin:0 0 14px 0;">${safeBizUrl}</p>` : ''}
                  <span style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#B86800;background-color:#FFFBF0;border:1px solid #E8C98A;padding:4px 10px;border-radius:20px;">&#9203; Unverified</span>
                </td>
              </tr>
              <tr>
                <td style="background-color:#FAFAFA;border-top:1px solid #E2E2E2;padding:10px 18px;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#888888;">Edit everything once you've claimed it</td>
                      <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#0A5C46;">${daysLeft} days to claim</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- PRIMARY CTA -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px 0;">
              <tr>
                <td>
                  <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${claimUrl}" style="height:48px;v-text-anchor:middle;width:200px;" arcsize="17%" strokecolor="#0A5C46" fillcolor="#0A5C46"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;">Claim your listing &rarr;</center></v:roundrect><![endif]-->
                  <!--[if !mso]><!-->
                  <a class="cta-btn" href="${claimUrl}" style="display:inline-block;background-color:#0A5C46;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:8px;letter-spacing:-0.1px;mso-hide:all;">Claim your listing &rarr;</a>
                  <!--<![endif]-->
                  <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888888;margin:8px 0 0 0;">Takes less than 5 minutes &nbsp;&middot;&nbsp; member.market</p>
                </td>
              </tr>
            </table>

            <!-- FOUNDER QUOTE -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F4F8F6;border-radius:10px;margin:24px 0;">
              <tr>
                <td style="padding:22px 24px;">
                  <p style="font-family:Georgia,'Times New Roman',serif;font-size:48px;color:#0A5C46;opacity:0.25;line-height:1;margin:0 0 -8px 0;">&ldquo;</p>
                  <p style="font-family:Georgia,'Times New Roman',serif;font-size:14px;font-style:italic;color:#222222;line-height:1.65;margin:0 0 16px 0;">More than once I've had a business need and done what we all do. Checked the EO directory. Posted in the WhatsApp needs and leads group. Waited. The directory didn't have what I needed. My post was buried in an hour. What frustrated me most wasn't the silence — it was knowing the right person was already in the network. Someone I'd trust. Someone who gets it. And still not being able to find them. Member Market is my attempt to fix that.</p>
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="vertical-align:middle;padding-right:10px;"><div style="width:36px;height:36px;background-color:#0A5C46;border-radius:50%;text-align:center;line-height:36px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#ffffff;display:inline-block;">AH</div></td>
                      <td style="vertical-align:middle;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#111111;margin:0;">Andrew Herbert</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;"><tr><td style="border-top:1px solid #E2E2E2;font-size:0;line-height:0;">&nbsp;</td></tr></table>

            <!-- HOW IT WORKS -->
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#111111;margin:0 0 16px 0;">How it works</p>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px 0;">
              <tr>
                <td style="vertical-align:top;width:28px;padding-right:14px;padding-top:1px;"><div style="width:28px;height:28px;background-color:#0A5C46;border-radius:50%;text-align:center;line-height:28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#ffffff;display:inline-block;">1</div></td>
                <td style="vertical-align:top;"><p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#111111;margin:0 0 3px 0;">Claim your listing</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#555555;line-height:1.55;margin:0;">Click above, create your account, and take ownership of the profile we've created for you. Edit anything — your services are blank and ready for you to add.</p></td>
              </tr>
            </table>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px 0;">
              <tr>
                <td style="vertical-align:top;width:28px;padding-right:14px;padding-top:1px;"><div style="width:28px;height:28px;background-color:#0A5C46;border-radius:50%;text-align:center;line-height:28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#ffffff;display:inline-block;">2</div></td>
                <td style="vertical-align:top;"><p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#111111;margin:0 0 3px 0;">Verify your EO status</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#555555;line-height:1.55;margin:0;">Select your membership — current EO member, EO Accelerator, or EO alumni. We'll walk you through the short verification process. Once verified, your listing moves to the top of search results for your services and region.</p></td>
              </tr>
            </table>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px 0;">
              <tr>
                <td style="vertical-align:top;width:28px;padding-right:14px;padding-top:1px;"><div style="width:28px;height:28px;background-color:#0A5C46;border-radius:50%;text-align:center;line-height:28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#ffffff;display:inline-block;">3</div></td>
                <td style="vertical-align:top;"><p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#111111;margin:0 0 3px 0;">Start getting found — and finding others</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#555555;line-height:1.55;margin:0;">EO members searching for your services will find your listing. When you post a need to the Needs &amp; Leads board, our AI concierge matches it to the right businesses and surfaces relevant past responses from the network — instantly.</p></td>
              </tr>
            </table>

            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;"><tr><td style="border-top:1px solid #E2E2E2;font-size:0;line-height:0;">&nbsp;</td></tr></table>

            <!-- FEATURES GRID -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px 0;">
              <tr>
                <td class="feature-grid-cell" style="vertical-align:top;width:48%;background-color:#F8F7F4;border-radius:8px;padding:14px;"><p style="font-size:18px;margin:0 0 7px 0;">&#128274;</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#111111;margin:0 0 3px 0;">EO members only</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.5;margin:0;">Every listing is verified. Only current members and verified alumni can access the directory.</p></td>
                <td class="feature-grid-spacer" style="width:4%;">&nbsp;</td>
                <td class="feature-grid-cell" style="vertical-align:top;width:48%;background-color:#F8F7F4;border-radius:8px;padding:14px;"><p style="font-size:18px;margin:0 0 7px 0;">&#129302;</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#111111;margin:0 0 3px 0;">AI Needs &amp; Leads concierge</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.5;margin:0;">Post a business need and the AI automatically matches and notifies the right businesses — and surfaces similar past responses from the network.</p></td>
              </tr>
              <tr><td colspan="3" style="padding-top:10px;"></td></tr>
              <tr>
                <td class="feature-grid-cell" style="vertical-align:top;width:48%;background-color:#F8F7F4;border-radius:8px;padding:14px;"><p style="font-size:18px;margin:0 0 7px 0;">&#129309;</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#111111;margin:0 0 3px 0;">Member endorsements</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.5;margin:0;">"I've worked with this business" endorsements from fellow EO members boost your search ranking over time.</p></td>
                <td class="feature-grid-spacer" style="width:4%;">&nbsp;</td>
                <td class="feature-grid-cell" style="vertical-align:top;width:48%;background-color:#F8F7F4;border-radius:8px;padding:14px;"><p style="font-size:18px;margin:0 0 7px 0;">&#128203;</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#111111;margin:0 0 3px 0;">Community Asks</p><p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.5;margin:0;">Post personal needs — finding a specialist abroad, a trusted contact in a new market — to the broader EO network.</p></td>
              </tr>
            </table>

            <!-- NON-SOL BOX -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0;border-left:3px solid #0A5C46;border-radius:0 8px 8px 0;background-color:#F8F7F4;">
              <tr><td style="padding:13px 16px;"><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#444444;line-height:1.65;margin:0;"><strong style="color:#111111;">How Member Market stays EO:</strong> This is a discovery platform, not a sales channel. Members search for you and choose to reach out — you never cold-contact them. Every interaction is buyer-initiated, consistent with EO's non-solicitation principles.</p></td></tr>
            </table>

            <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.75;margin:0 0 20px 0;">Your listing will remain live for <strong style="color:#111111;">${daysLeft} days</strong> while you decide whether to claim it. Claim it now and it's yours indefinitely — no charge, no catch.</p>

            <!-- SECONDARY CTA -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 4px 0;">
              <tr>
                <td>
                  <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${claimUrl}" style="height:48px;v-text-anchor:middle;width:200px;" arcsize="17%" strokecolor="#0A5C46" fillcolor="#0A5C46"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;">Claim your listing &rarr;</center></v:roundrect><![endif]-->
                  <!--[if !mso]><!-->
                  <a class="cta-btn" href="${claimUrl}" style="display:inline-block;background-color:#0A5C46;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:8px;mso-hide:all;">Claim your listing &rarr;</a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888888;margin:8px 0 0 0;">member.market &nbsp;&middot;&nbsp; Private &nbsp;&middot;&nbsp; EO members only</p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td class="email-footer" style="background-color:#F4F3F0;padding:20px 36px;border-top:1px solid #E2E2E2;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#888888;line-height:1.7;margin:0 0 4px 0;">You received this because you've been identified as an EO member. Member Market is a member-led initiative — not an official EO Global product.</p>
            ${removeUrl ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#888888;line-height:1.7;margin:0 0 6px 0;">If you'd prefer not to be listed, <a href="${removeUrl}" style="color:#888888;text-decoration:underline;">remove your listing here</a> and you won't hear from us again.</p>` : ''}
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#888888;margin:0;">Member Market &nbsp;&middot;&nbsp; <a href="https://member.market" style="color:#888888;text-decoration:underline;">member.market</a></p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, html }
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
