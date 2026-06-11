import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createSsrClient } from '@/lib/supabase/server'
import { completeWhatsAppLink } from '@/services/whatsapp/complete-link'
import { siteUrl } from '@/lib/site-url'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(request: NextRequest) {
  const base = siteUrl()
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing_token', base))
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.redirect(new URL('/login?error=server_error', base))
  }

  const db = adminDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  // Look up the token
  const { data: linkToken } = await dbAny
    .from('whatsapp_link_tokens')
    .select('id, shadow_user_id, target_email, expires_at, consumed_at')
    .eq('token', token)
    .maybeSingle() as {
      data: {
        id: string
        shadow_user_id: string
        target_email: string
        expires_at: string
        consumed_at: string | null
      } | null
    }

  if (!linkToken) {
    return NextResponse.redirect(new URL('/login?error=invalid_token', base))
  }

  if (linkToken.consumed_at) {
    return NextResponse.redirect(new URL('/dashboard?toast=whatsapp-already-linked', base))
  }

  if (new Date(linkToken.expires_at) < new Date()) {
    return NextResponse.redirect(new URL('/login?error=token_expired', base))
  }

  // Look up the shadow user's JID (needed both to link now and to carry in the cookie).
  const { data: shadowUser } = await dbAny
    .from('shadow_users')
    .select('whatsapp_jid')
    .eq('id', linkToken.shadow_user_id)
    .maybeSingle() as { data: { whatsapp_jid: string } | null }

  const link = {
    jid: shadowUser?.whatsapp_jid ?? null,
    tokenId: linkToken.id,
    shadowUserId: linkToken.shadow_user_id,
  }

  // If the user is ALREADY logged in, complete the link immediately and skip
  // the login round-trip. (Otherwise the middleware bounces a logged-in user
  // off /login to /marketplace and the link cookie is never consumed.)
  try {
    const ssr = await createSsrClient()
    const { data: { user } } = await ssr.auth.getUser()
    if (user) {
      await completeWhatsAppLink(user.id, link)
      return NextResponse.redirect(new URL('/dashboard?toast=whatsapp-linked', base))
    }
  } catch (err) {
    console.error('[whatsapp-link] session check failed, falling back to login flow:', err)
  }

  // Not logged in: stash the link intent in a cookie and send them to login.
  // The cookie must be set ON THE REDIRECT RESPONSE so the browser carries it
  // through the login → completion flow (signIn() / /auth/callback read it).
  const cookieValue = Buffer.from(JSON.stringify(link)).toString('base64url')

  const loginUrl = new URL('/login', base)
  loginUrl.searchParams.set('next', '/dashboard?toast=whatsapp-linked')

  const response = NextResponse.redirect(loginUrl)
  response.cookies.set('wa_pending_link', cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes — enough to complete login
    path: '/',
  })

  return response
}
