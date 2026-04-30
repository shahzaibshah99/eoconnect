import { type NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createMiddlewareClient } from '@/lib/supabase/middleware-client'
import type { EoMembershipType, UserRole, UserStatus } from '@/types/database'

type ProfileRow = {
  role: UserRole
  status: UserStatus
  eo_membership_type: EoMembershipType | null
  country: string | null
  region: string | null
  onboarded_at: string | null
}

export async function proxy(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request)
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  const pathname = request.nextUrl.pathname

  // Build redirect targets against the configured public URL when possible.
  // Behind a reverse proxy (Dokploy/Traefik) that doesn't forward the Host
  // header, request.url shows the container's internal bind ('0.0.0.0:3000')
  // and that origin leaks into every middleware redirect target.
  const publicBase = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, publicBase || request.url))

  const protectedPaths = ['/dashboard', '/marketplace', '/admin', '/onboarding']
  const isProtected = protectedPaths.some(p => pathname.startsWith(p))
  // Note on what's NOT in this list:
  //   /suspended       — destination page for suspended users; bouncing
  //                      it would loop with the suspended-status gate
  //                      below.
  //   /reset-password  — the password recovery flow goes through
  //                      /auth/callback first, which leaves the user with
  //                      an active recovery session. If /reset-password
  //                      were in authPages, that session would bounce them
  //                      to /marketplace before they can set a new
  //                      password — broken UX. The page itself handles
  //                      the recovery state via Supabase's PASSWORD_RECOVERY
  //                      auth event + the ?type=recovery query param.
  const authPages = ['/login', '/signup', '/verify']
  const isAuthPage = authPages.some(p => pathname.startsWith(p))

  if (!user && isProtected) {
    return redirectTo('/login')
  }

  if (user && isAuthPage) {
    return redirectTo('/marketplace')
  }

  if (!user) return response

  // Single profile fetch for all gating below.
  let { data: profile } = await supabase
    .from('profiles')
    .select('role, status, eo_membership_type, country, region, onboarded_at')
    .eq('id', user.id)
    .maybeSingle() as { data: ProfileRow | null; error: unknown }

  // Defensive: if no profile row exists (e.g. user signed up before the
  // auto-create trigger in migration 003, or the trigger silently failed),
  // create one now using the service role and re-fetch.
  if (!profile && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } }
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adminAny = admin as any
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>
      await adminAny.from('profiles').upsert({
        id: user.id,
        full_name: (meta.full_name as string) ?? (meta.name as string) ?? user.email?.split('@')[0] ?? 'Member',
        avatar_url: (meta.avatar_url as string | undefined) ?? null,
        eo_membership_email: user.email ?? null,
        // onboarded_at left null so brand-new signups still flow through onboarding
      }, { onConflict: 'id' })

      const refetch = await supabase
        .from('profiles')
        .select('role, status, eo_membership_type, country, region, onboarded_at')
        .eq('id', user.id)
        .maybeSingle() as { data: ProfileRow | null }
      profile = refetch.data
    } catch (err) {
      console.error('[middleware] profile upsert failed:', err)
    }
  }

  if (profile?.status === 'suspended' && pathname !== '/suspended') {
    return redirectTo('/suspended')
  }

  if (pathname.startsWith('/admin')) {
    if (!profile || !['chapter_admin', 'super_admin'].includes(profile.role)) {
      return redirectTo('/dashboard')
    }
  }

  // Onboarding gate — only fires for genuine new signups (onboarded_at IS NULL).
  // Existing users were grandfathered in migration 005.
  if (profile && !profile.onboarded_at) {
    const p = profile
    const exemptFromOnboardingGate =
      pathname === '/onboarding' ||
      pathname.startsWith('/auth') ||
      pathname.startsWith('/api') ||
      pathname.startsWith('/_next') ||
      pathname === '/'

    // The gate fires until both `eo_membership_type` and `region` are set —
    // these are the two mandatory fields the onboarding form writes.
    //
    // We deliberately use `region` here (not `country`). The structured
    // location model lets a member pick a "Bridge" chapter (e.g. EO MEPA
    // Bridge, EO LAC Bridge) which has region but no country. The earlier
    // check on `country` falsely treated those members as "not onboarded"
    // and bounced them to /onboarding, while the onboarding page checked
    // `region` and bounced them away — infinite redirect loop.
    if (!exemptFromOnboardingGate && (!p.eo_membership_type || !p.region)) {
      return redirectTo('/onboarding')
    }

    const exemptFromBusinessGate =
      exemptFromOnboardingGate ||
      pathname.startsWith('/dashboard/business/new') ||
      pathname.startsWith('/admin')

    if (!exemptFromBusinessGate && p.eo_membership_type && p.region) {
      const { data: business } = await supabase
        .from('businesses')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle() as { data: { id: string } | null; error: unknown }

      if (!business) {
        return redirectTo('/dashboard/business/new')
      }
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)'],
}
