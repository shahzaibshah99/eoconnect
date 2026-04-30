import 'server-only'

/**
 * Resolve the public site URL or throw in production.
 *
 * Used everywhere we embed the URL in an outbound email, pass it as a
 * redirect_to to Supabase, or build an absolute URL on the server.
 *
 * Background: a missing NEXT_PUBLIC_SITE_URL env var on the deployment
 * silently produced links like 'http://localhost:3000/...' or
 * 'undefined/...' that ended up in customers' inboxes for days. Failing
 * loud is the only way to catch the misconfig before users do.
 */
export function siteUrl(): string {
  const v = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (v) return v.replace(/\/$/, '')
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL is not set in production')
  }
  return 'http://localhost:3000'
}
