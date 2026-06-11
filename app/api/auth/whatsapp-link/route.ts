import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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

  // Encode the pending link intent into a cookie so the auth callback can
  // complete the binding after the user authenticates.
  // The cookie must be set ON THE REDIRECT RESPONSE so the browser carries
  // it through the login → OAuth callback flow.
  const pendingLinkValue = Buffer.from(
    JSON.stringify({ jid: null, tokenId: linkToken.id, shadowUserId: linkToken.shadow_user_id })
  ).toString('base64url')

  // We need the shadow user's JID to set up the cookie properly
  const { data: shadowUser } = await dbAny
    .from('shadow_users')
    .select('whatsapp_jid')
    .eq('id', linkToken.shadow_user_id)
    .maybeSingle() as { data: { whatsapp_jid: string } | null }

  const cookieValue = Buffer.from(
    JSON.stringify({
      jid: shadowUser?.whatsapp_jid ?? null,
      tokenId: linkToken.id,
      shadowUserId: linkToken.shadow_user_id,
    })
  ).toString('base64url')

  // Redirect to login with next=/dashboard?toast=whatsapp-linked
  const loginUrl = new URL('/login', base)
  loginUrl.searchParams.set('next', '/dashboard?toast=whatsapp-linked')

  const response = NextResponse.redirect(loginUrl)

  // Set cookie BEFORE returning the redirect — browser stores it and
  // carries it through the login → /auth/callback flow
  response.cookies.set('wa_pending_link', cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes — enough to complete login
    path: '/',
  })

  return response
}
