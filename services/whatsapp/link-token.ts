import 'server-only'
import { randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

interface MintTokenResult {
  ok: boolean
  token?: string
  error?: string
}

export async function mintLinkToken(
  shadowUserId: string,
  targetEmail: string
): Promise<MintTokenResult> {
  const db = adminDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  const token = randomBytes(32).toString('hex')

  const { error } = await dbAny
    .from('whatsapp_link_tokens')
    .insert({
      token,
      shadow_user_id: shadowUserId,
      target_email: targetEmail,
    })

  if (error) {
    console.error('[link-token] insert failed:', error.message)
    return { ok: false, error: error.message }
  }

  return { ok: true, token }
}

export async function sendLinkEmail(email: string, token: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? ''
  const linkUrl = `${base}/api/auth/whatsapp-link?token=${token}`

  await sendEmail({
    to: email,
    subject: 'Link your WhatsApp to Member Market',
    html: linkEmailHtml(linkUrl),
  })
}

function linkEmailHtml(linkUrl: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9f6f0;">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
    <h1 style="font-size:18px;margin:0 0 12px;">Link your WhatsApp to Member Market</h1>
    <p style="font-size:14px;color:#444;line-height:1.5;">
      You sent a business need from WhatsApp. Click the button below to link your WhatsApp number to your Member Market account so future posts appear under your name.
    </p>
    <p style="margin-top:24px;">
      <a href="${linkUrl}" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
        Link my account
      </a>
    </p>
    <p style="font-size:12px;color:#999;margin-top:24px;">
      This link expires in 24 hours. If you didn't expect this email, you can ignore it.
    </p>
  </div>
</body></html>`
}
