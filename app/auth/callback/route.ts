import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Whitelist of paths the OAuth/recovery callback is allowed to land users on
 * after a successful code exchange. Anything not on this prefix list falls
 * back to /marketplace.
 *
 * The previous check (`startsWith('/') && !startsWith('//')`) blocked
 * protocol-relative URLs but happily redirected users to any internal path
 * an attacker chose to put in `?next=...`. With recovery codes that grants
 * a fully privileged session, an attacker could craft a recovery email
 * link that drops the victim on `/dashboard/account?…` instead of the
 * password-set form — bypassing the recovery semantics entirely.
 */
const ALLOWED_NEXT_PREFIXES = [
  '/marketplace',
  '/dashboard',
  '/onboarding',
  '/reset-password',
  '/admin',
  '/messages',
] as const

function safeNext(raw: string | null): string {
  const fallback = '/marketplace'
  if (!raw) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback
  // Strip query string for the prefix check, then keep the original.
  const pathOnly = raw.split('?')[0]
  if (!ALLOWED_NEXT_PREFIXES.some(p => pathOnly === p || pathOnly.startsWith(p + '/') || pathOnly.startsWith(p + '?'))) {
    return fallback
  }
  return raw
}

function resolveOrigin(requestUrl: URL): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  // Fall back to the request origin only in non-production. In production
  // behind a reverse proxy the origin can leak as 'http://0.0.0.0:3000' and
  // poison every redirect we issue. Fail loud instead.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL is not set — refusing to issue redirects from /auth/callback')
  }
  return requestUrl.origin
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const origin = resolveOrigin(requestUrl)
  const searchParams = requestUrl.searchParams
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  if (code) {
    const redirectUrl = new URL(next, origin)
    const response = NextResponse.redirect(redirectUrl)

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return response
    }
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message)
  }

  return NextResponse.redirect(new URL('/login?error=auth_callback_failed', origin))
}
